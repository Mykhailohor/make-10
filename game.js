"use strict";

const numberRack = document.getElementById("numberRack");
const operatorRack = document.getElementById("operatorRack");
const expression = document.getElementById("expression");
const placeholder = document.getElementById("placeholder");
const insertMarker = document.getElementById("insertMarker");
const resultText = document.getElementById("resultText");
const message = document.getElementById("message");

const streakEl = document.getElementById("streak");
const timerEl = document.getElementById("timer");
const winCard = document.getElementById("winCard");
const winTime = document.getElementById("winTime");

const checkBtn = document.getElementById("checkBtn");
const clearBtn = document.getElementById("clearExpression");
const undoBtn = document.getElementById("undoBtn");
const hintBtn = document.getElementById("hintBtn");
const hintCountEl = document.getElementById("hintCount");
const hintPanel = document.getElementById("hintPanel");
const hintTextEl = document.getElementById("hintText");
const nextPuzzleBtn = document.getElementById("nextPuzzle");

const dragGhost = document.getElementById("dragGhost");

const DISPLAY = {
  "*": "×",
  "/": "÷"
};

let puzzleNumbers = [];
let expressionTokens = [];
let nextTokenId = 1;
let streak = 0;
let solved = false;
let puzzleStartTime = performance.now();
let frozenElapsedMs = 0;
let lastReturnedIndex = null;

const savedHints = localStorage.getItem("make10Hints");
let hints = savedHints === null
  ? 2
  : Math.max(0, Number.parseInt(savedHints, 10) || 0);

let solvedTotal = Math.max(
  0,
  Number.parseInt(localStorage.getItem("make10SolvedTotal") || "0", 10) || 0
);

let currentPuzzleSolution = null;
let hintStepIndex = 0;

let pointerDrag = null;
let suppressClickUntil = 0;

// ---------- YouTube Playables ----------

function inYouTubePlayables() {
  return typeof window.ytgame !== "undefined" && !!window.ytgame.IN_PLAYABLES_ENV;
}

function youtubeReady() {
  if (typeof window.ytgame === "undefined") return;

  try {
    window.ytgame.game.firstFrameReady();
  } catch (_) {}

  try {
    window.ytgame.game.gameReady();
  } catch (_) {}
}

function sendScore() {
  if (!inYouTubePlayables()) return;

  try {
    window.ytgame.engagement.sendScore({ value: streak });
  } catch (_) {}
}

// ---------- Timer ----------

function elapsedMs() {
  return solved ? frozenElapsedMs : performance.now() - puzzleStartTime;
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timerLoop() {
  timerEl.textContent = formatTime(elapsedMs());
  requestAnimationFrame(timerLoop);
}

// ---------- Puzzle generation ----------

function randomDigit() {
  return Math.floor(Math.random() * 9) + 1;
}

function cleanNumber(value) {
  const rounded = Math.round(value * 1000000) / 1000000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function findSolution(numbers) {
  const startItems = numbers.map(value => ({
    value,
    expr: String(value)
  }));

  function search(items, history) {
    if (items.length === 1) {
      if (Math.abs(items[0].value - 10) < 1e-9) {
        return {
          expression: items[0].expr,
          steps: history
        };
      }
      return null;
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        const rest = items.filter((_, index) => index !== i && index !== j);

        const candidates = [
          {
            value: a.value + b.value,
            expr: `(${a.expr} + ${b.expr})`,
            step: `${a.expr} + ${b.expr} = ${cleanNumber(a.value + b.value)}`
          },
          {
            value: a.value - b.value,
            expr: `(${a.expr} - ${b.expr})`,
            step: `${a.expr} − ${b.expr} = ${cleanNumber(a.value - b.value)}`
          },
          {
            value: b.value - a.value,
            expr: `(${b.expr} - ${a.expr})`,
            step: `${b.expr} − ${a.expr} = ${cleanNumber(b.value - a.value)}`
          },
          {
            value: a.value * b.value,
            expr: `(${a.expr} * ${b.expr})`,
            step: `${a.expr} × ${b.expr} = ${cleanNumber(a.value * b.value)}`
          }
        ];

        if (Math.abs(b.value) > 1e-12) {
          candidates.push({
            value: a.value / b.value,
            expr: `(${a.expr} / ${b.expr})`,
            step: `${a.expr} ÷ ${b.expr} = ${cleanNumber(a.value / b.value)}`
          });
        }

        if (Math.abs(a.value) > 1e-12) {
          candidates.push({
            value: b.value / a.value,
            expr: `(${b.expr} / ${a.expr})`,
            step: `${b.expr} ÷ ${a.expr} = ${cleanNumber(b.value / a.value)}`
          });
        }

        for (const candidate of candidates) {
          if (!Number.isFinite(candidate.value)) continue;

          const result = search(
            [...rest, { value: candidate.value, expr: candidate.expr }],
            [...history, candidate.step]
          );

          if (result) return result;
        }
      }
    }

    return null;
  }

  return search(startItems, []);
}

function generateSolvablePuzzle() {
  for (let attempt = 0; attempt < 500; attempt++) {
    const nums = [randomDigit(), randomDigit(), randomDigit(), randomDigit()];
    const solution = findSolution(nums);

    if (solution) {
      return { numbers: nums, solution };
    }
  }

  const fallback = [1, 2, 3, 4];
  return {
    numbers: fallback,
    solution: findSolution(fallback)
  };
}

// ---------- Tokens ----------

function makeNumberToken(value, sourceIndex) {
  return {
    id: nextTokenId++,
    type: "number",
    value: String(value),
    sourceIndex
  };
}

function makeOperatorToken(value) {
  return {
    id: nextTokenId++,
    type: "operator",
    value
  };
}

function usedNumberIndexes() {
  return new Set(
    expressionTokens
      .filter(token => token.type === "number")
      .map(token => token.sourceIndex)
  );
}

function addNumberByIndex(index, insertAt = expressionTokens.length) {
  if (solved) return;

  const used = usedNumberIndexes();
  if (used.has(index)) return;

  const token = makeNumberToken(puzzleNumbers[index], index);
  expressionTokens.splice(clampInsertIndex(insertAt), 0, token);
  setMessage("");
  render();
}

function addOperator(value, insertAt = expressionTokens.length) {
  if (solved) return;

  const token = makeOperatorToken(value);
  expressionTokens.splice(clampInsertIndex(insertAt), 0, token);
  setMessage("");
  render();
}

function clampInsertIndex(index) {
  return Math.max(0, Math.min(index, expressionTokens.length));
}

// Adds the return animation to exactly one render.
// The state is cleared immediately afterwards, so another render
// cannot accidentally replay the animation on the same digit.
function renderWithReturnedNumberAnimation(sourceIndex) {
  lastReturnedIndex = sourceIndex;
  render();
  lastReturnedIndex = null;
}

function removeTokenById(id, animateReturn = true) {
  if (solved) return;

  const index = expressionTokens.findIndex(token => token.id === id);
  if (index === -1) return;

  const [removed] = expressionTokens.splice(index, 1);

  setMessage("");

  if (animateReturn && removed.type === "number") {
    renderWithReturnedNumberAnimation(removed.sourceIndex);
  } else {
    render();
  }
}

function moveExpressionToken(id, targetIndex) {
  if (solved) return;

  const currentIndex = expressionTokens.findIndex(token => token.id === id);
  if (currentIndex === -1) return;

  const [token] = expressionTokens.splice(currentIndex, 1);

  let adjustedIndex = clampInsertIndex(targetIndex);
  if (currentIndex < targetIndex) adjustedIndex--;

  expressionTokens.splice(
    Math.max(0, Math.min(adjustedIndex, expressionTokens.length)),
    0,
    token
  );

  render();
}

// ---------- Rendering ----------

function renderNumbers() {
  numberRack.innerHTML = "";
  const used = usedNumberIndexes();

  puzzleNumbers.forEach((value, index) => {
    const slot = document.createElement("div");
    slot.className = "number-slot";

    const button = document.createElement("button");
    button.className = "number-tile";
    button.textContent = value;
    button.dataset.index = index;
    button.setAttribute("aria-label", t("digit_label", { value }));

    if (used.has(index)) {
      button.classList.add("used");
    }

    if (lastReturnedIndex === index && !used.has(index)) {
      button.classList.add("just-returned");
    }

    button.addEventListener("click", () => {
      if (performance.now() < suppressClickUntil) return;
      addNumberByIndex(index);
    });

    setupPointerDrag(button, {
      kind: "number-source",
      sourceIndex: index,
      value: String(value),
      tokenType: "number",
      disabled: () => usedNumberIndexes().has(index) || solved
    });

    slot.appendChild(button);
    numberRack.appendChild(slot);
  });
}

function renderExpression() {
  expression.querySelectorAll(".expression-token").forEach(el => el.remove());

  placeholder.style.display = expressionTokens.length ? "none" : "block";

  expressionTokens.forEach((token, index) => {
    const el = document.createElement("div");
    el.className = `expression-token ${token.type}`;
    el.textContent = DISPLAY[token.value] || token.value;
    el.dataset.id = token.id;
    el.dataset.index = index;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", t("token_label", { value: el.textContent }));

    el.addEventListener("click", () => {
      if (performance.now() < suppressClickUntil) return;
      removeTokenById(token.id);
    });

    setupPointerDrag(el, {
      kind: "expression-token",
      tokenId: token.id,
      value: token.value,
      tokenType: token.type,
      disabled: () => solved
    });

    expression.insertBefore(el, insertMarker);
  });
}

function renderResult() {
  const evaluated = tryEvaluateExpression();

  if (evaluated.ok) {
    const rounded = Math.round(evaluated.value * 10000) / 10000;
    resultText.textContent = `= ${rounded}`;
  } else {
    resultText.textContent = "= ?";
  }
}

function render() {
  renderNumbers();
  renderExpression();
  renderResult();
  streakEl.textContent = String(streak);

  expression.classList.toggle("solved", solved);
  winCard.classList.toggle("hidden", !solved);

  checkBtn.disabled = solved;
  clearBtn.disabled = solved;
  undoBtn.disabled = solved;
  updateHintButton();
}

// ---------- Pointer drag & drop ----------

function setupPointerDrag(element, data) {
  element.addEventListener("pointerdown", event => {
    if (event.button !== undefined && event.button !== 0) return;
    if (data.disabled && data.disabled()) return;

    pointerDrag = {
      ...data,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      sourceElement: element,
      insertIndex: expressionTokens.length
    };

    try {
      element.setPointerCapture(event.pointerId);
    } catch (_) {}
  });

  element.addEventListener("pointermove", event => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;

    const dx = event.clientX - pointerDrag.startX;
    const dy = event.clientY - pointerDrag.startY;
    const distance = Math.hypot(dx, dy);

    if (!pointerDrag.moved && distance > 7) {
      pointerDrag.moved = true;
      beginVisualDrag();
    }

    if (!pointerDrag.moved) return;

    event.preventDefault();
    pointerDrag.x = event.clientX;
    pointerDrag.y = event.clientY;

    moveGhost(event.clientX, event.clientY);
    updateDropTargets(event.clientX, event.clientY);
  });

  const finish = event => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;

    if (pointerDrag.moved) {
      event.preventDefault();
      completePointerDrop(event.clientX, event.clientY);
      suppressClickUntil = performance.now() + 280;
    }

    cleanupPointerDrag();
  };

  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", cleanupPointerDrag);
}

function beginVisualDrag() {
  if (!pointerDrag) return;

  document.body.classList.add("dragging-active");

  dragGhost.textContent = DISPLAY[pointerDrag.value] || pointerDrag.value;
  dragGhost.className = `drag-ghost ${pointerDrag.tokenType || ""}`;
  moveGhost(pointerDrag.x, pointerDrag.y);

  if (pointerDrag.kind === "expression-token") {
    pointerDrag.sourceElement.classList.add("drag-source");
  }
}

function moveGhost(x, y) {
  dragGhost.style.left = `${x}px`;
  dragGhost.style.top = `${y}px`;
}

function updateDropTargets(x, y) {
  const exprRect = expression.getBoundingClientRect();
  const rackRect = numberRack.getBoundingClientRect();

  const overExpression = pointInRect(x, y, exprRect);
  const overRack = pointInRect(x, y, rackRect);

  expression.classList.toggle("drag-over", overExpression);
  numberRack.classList.toggle(
    "return-target",
    overRack && pointerDrag?.kind === "expression-token"
  );

  if (overExpression) {
    pointerDrag.insertIndex = findInsertionIndex(x, y);
    placeInsertMarker(pointerDrag.insertIndex);
  } else {
    hideInsertMarker();
  }
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function getExpressionElements() {
  return [...expression.querySelectorAll(".expression-token")];
}

function findInsertionIndex(x, y) {
  const items = getExpressionElements();

  if (!items.length) return 0;

  let bestIndex = items.length;
  let bestScore = Infinity;

  items.forEach((item, index) => {
    const rect = item.getBoundingClientRect();

    const beforeX = rect.left;
    const afterX = rect.right;
    const centerY = rect.top + rect.height / 2;

    const beforeScore = Math.hypot(x - beforeX, (y - centerY) * 1.35);
    const afterScore = Math.hypot(x - afterX, (y - centerY) * 1.35);

    if (beforeScore < bestScore) {
      bestScore = beforeScore;
      bestIndex = index;
    }

    if (afterScore < bestScore) {
      bestScore = afterScore;
      bestIndex = index + 1;
    }
  });

  return bestIndex;
}

function placeInsertMarker(index) {
  const items = getExpressionElements();

  insertMarker.classList.add("visible");

  if (index >= items.length) {
    expression.appendChild(insertMarker);
  } else {
    expression.insertBefore(insertMarker, items[index]);
  }
}

function hideInsertMarker() {
  insertMarker.classList.remove("visible");
  expression.appendChild(insertMarker);
}

function completePointerDrop(x, y) {
  if (!pointerDrag) return;

  const exprRect = expression.getBoundingClientRect();
  const rackRect = numberRack.getBoundingClientRect();

  if (pointInRect(x, y, exprRect)) {
    const index = pointerDrag.insertIndex ?? expressionTokens.length;

    if (pointerDrag.kind === "number-source") {
      addNumberByIndex(pointerDrag.sourceIndex, index);
    } else if (pointerDrag.kind === "operator-source") {
      addOperator(pointerDrag.value, index);
    } else if (pointerDrag.kind === "expression-token") {
      moveExpressionToken(pointerDrag.tokenId, index);
    }

    return;
  }

  if (
    pointInRect(x, y, rackRect) &&
    pointerDrag.kind === "expression-token"
  ) {
    removeTokenById(pointerDrag.tokenId, true);
  }
}

function cleanupPointerDrag() {
  if (pointerDrag?.sourceElement) {
    pointerDrag.sourceElement.classList.remove("drag-source");
  }

  pointerDrag = null;
  dragGhost.className = "drag-ghost hidden";
  document.body.classList.remove("dragging-active");
  expression.classList.remove("drag-over");
  numberRack.classList.remove("return-target");
  hideInsertMarker();
}

// Operators can be clicked or dragged repeatedly.
operatorRack.querySelectorAll(".operator").forEach(button => {
  const value = button.dataset.token;

  button.addEventListener("click", () => {
    if (performance.now() < suppressClickUntil) return;
    addOperator(value);
  });

  setupPointerDrag(button, {
    kind: "operator-source",
    value,
    tokenType: "operator",
    disabled: () => solved
  });
});



// ---------- Localization ----------

const translations = {
  en: {
    menu_eyebrow: "PUZZLE GAME",
    start: "Start",
    how_to_play: "How to play",
    how_to_play_upper: "HOW TO PLAY",
    how_title: "Make 10 from four digits",
    how_intro: "Use all 4 digits exactly once and build an expression equal to 10.",
    rule_ops: "You can use <strong>+ − × ÷</strong> and parentheses.",
    rule_repeat: "Operators can be used more than once.",
    rule_drag: "Tap or drag digits and operators.",
    rule_reorder: "You can reorder elements inside the expression.",
    got_it_start: "Got it, start",
    menu: "Menu",
    streak: "STREAK",
    time: "TIME",
    game_rule: "Use all 4 digits exactly once.",
    digits: "DIGITS",
    hint: "Hint",
    rule_hints: "You start with 2 hints and earn +1 after every 3 solved puzzles.",
    msg_hint: "💡 Try: {step}",
    msg_hint_solution: "💡 Solution: {solution}",
    msg_no_hints: "No hints left. Solve puzzles to earn more.",
    msg_hint_used_up: "You already revealed all hints for this puzzle.",
    msg_correct_bonus: "✓ Great! You made 10. 💡 +1 hint earned!",
    new_set: "New set",
    expression: "EXPRESSION",
    clear: "Clear",
    drop_hint: "Drag digits and operators here",
    operators: "OPERATORS",
    operators_hint: "can be used multiple times",
    check: "Check",
    undo: "Undo",
    correct_upper: "CORRECT",
    next_puzzle: "Next puzzle",
    footer_hint: "Drag elements or tap them. Drag a digit back up to return it.",
    msg_use_all: "Use all 4 digits.",
    msg_unique: "Each digit can only be used once.",
    msg_correct: "✓ Great! You made 10.",
    msg_got: "You got {value}, but you need 10.",
    err_operator: "An operator is in the wrong place",
    err_between_numbers: "An operator is needed between numbers",
    err_before_paren: "An operator is needed before the parenthesis",
    err_bad_close: "Invalid closing parenthesis",
    err_missing_open: "Missing opening parenthesis",
    err_incomplete: "The expression is incomplete",
    err_empty: "Empty expression",
    err_div_zero: "You cannot divide by zero",
    err_invalid_result: "Invalid result",
    err_invalid_expression: "Invalid expression",
    digit_label: "Digit {value}",
    token_label: "Element {value}. Tap to remove.",
    close: "Close"
  },
  fr: {
    menu_eyebrow: "JEU DE RÉFLEXION",
    start: "Jouer",
    how_to_play: "Comment jouer",
    how_to_play_upper: "COMMENT JOUER",
    how_title: "Obtiens 10 avec quatre chiffres",
    how_intro: "Utilise les 4 chiffres exactement une fois pour créer une expression égale à 10.",
    rule_ops: "Tu peux utiliser <strong>+ − × ÷</strong> et des parenthèses.",
    rule_repeat: "Les opérateurs peuvent être utilisés plusieurs fois.",
    rule_drag: "Appuie ou fais glisser les chiffres et les opérateurs.",
    rule_reorder: "Tu peux réorganiser les éléments dans l’expression.",
    got_it_start: "Compris, jouer",
    menu: "Menu",
    streak: "SÉRIE",
    time: "TEMPS",
    game_rule: "Utilise les 4 chiffres exactement une fois.",
    digits: "CHIFFRES",
    hint: "Indice",
    rule_hints: "Tu commences avec 2 indices et tu en gagnes +1 toutes les 3 énigmes résolues.",
    msg_hint: "💡 Essaie : {step}",
    msg_hint_solution: "💡 Solution : {solution}",
    msg_no_hints: "Plus d’indices. Résous des énigmes pour en gagner.",
    msg_hint_used_up: "Tu as déjà révélé tous les indices de cette énigme.",
    msg_correct_bonus: "✓ Bravo ! Tu as obtenu 10. 💡 +1 indice gagné !",
    new_set: "Nouveau tirage",
    expression: "EXPRESSION",
    clear: "Effacer",
    drop_hint: "Fais glisser ici les chiffres et les opérateurs",
    operators: "OPÉRATEURS",
    operators_hint: "utilisables plusieurs fois",
    check: "Vérifier",
    undo: "Annuler",
    correct_upper: "CORRECT",
    next_puzzle: "Prochain défi",
    footer_hint: "Fais glisser les éléments ou appuie dessus. Ramène un chiffre en haut pour le retirer.",
    msg_use_all: "Tu dois utiliser les 4 chiffres.",
    msg_unique: "Chaque chiffre ne peut être utilisé qu’une seule fois.",
    msg_correct: "✓ Bravo ! Tu as obtenu 10.",
    msg_got: "Tu as obtenu {value}, mais il faut 10.",
    err_operator: "Un opérateur est mal placé",
    err_between_numbers: "Il faut un opérateur entre les nombres",
    err_before_paren: "Il faut un opérateur avant la parenthèse",
    err_bad_close: "Parenthèse fermante incorrecte",
    err_missing_open: "Il manque une parenthèse ouvrante",
    err_incomplete: "L’expression est incomplète",
    err_empty: "Expression vide",
    err_div_zero: "Impossible de diviser par zéro",
    err_invalid_result: "Résultat invalide",
    err_invalid_expression: "Expression invalide",
    digit_label: "Chiffre {value}",
    token_label: "Élément {value}. Appuie pour le retirer.",
    close: "Fermer"
  },
  es: {
    menu_eyebrow: "JUEGO DE LÓGICA",
    start: "Jugar",
    how_to_play: "Cómo jugar",
    how_to_play_upper: "CÓMO JUGAR",
    how_title: "Consigue 10 con cuatro cifras",
    how_intro: "Usa las 4 cifras exactamente una vez para crear una expresión igual a 10.",
    rule_ops: "Puedes usar <strong>+ − × ÷</strong> y paréntesis.",
    rule_repeat: "Los operadores se pueden usar varias veces.",
    rule_drag: "Pulsa o arrastra las cifras y los operadores.",
    rule_reorder: "Puedes reordenar los elementos dentro de la expresión.",
    got_it_start: "Entendido, jugar",
    menu: "Menú",
    streak: "RACHA",
    time: "TIEMPO",
    game_rule: "Usa las 4 cifras exactamente una vez.",
    digits: "CIFRAS",
    hint: "Pista",
    rule_hints: "Empiezas con 2 pistas y ganas +1 cada 3 retos resueltos.",
    msg_hint: "💡 Prueba: {step}",
    msg_hint_solution: "💡 Solución: {solution}",
    msg_no_hints: "No quedan pistas. Resuelve retos para conseguir más.",
    msg_hint_used_up: "Ya has revelado todas las pistas de este reto.",
    msg_correct_bonus: "✓ ¡Genial! Has conseguido 10. 💡 ¡+1 pista!",
    new_set: "Nuevo grupo",
    expression: "EXPRESIÓN",
    clear: "Limpiar",
    drop_hint: "Arrastra aquí las cifras y los operadores",
    operators: "OPERADORES",
    operators_hint: "se pueden usar varias veces",
    check: "Comprobar",
    undo: "Deshacer",
    correct_upper: "CORRECTO",
    next_puzzle: "Siguiente reto",
    footer_hint: "Arrastra los elementos o púlsalos. Devuelve una cifra arriba para quitarla.",
    msg_use_all: "Debes usar las 4 cifras.",
    msg_unique: "Cada cifra solo se puede usar una vez.",
    msg_correct: "✓ ¡Genial! Has conseguido 10.",
    msg_got: "Has obtenido {value}, pero necesitas 10.",
    err_operator: "Hay un operador en una posición incorrecta",
    err_between_numbers: "Hace falta un operador entre los números",
    err_before_paren: "Hace falta un operador antes del paréntesis",
    err_bad_close: "Paréntesis de cierre incorrecto",
    err_missing_open: "Falta un paréntesis de apertura",
    err_incomplete: "La expresión está incompleta",
    err_empty: "Expresión vacía",
    err_div_zero: "No se puede dividir entre cero",
    err_invalid_result: "Resultado no válido",
    err_invalid_expression: "Expresión no válida",
    digit_label: "Cifra {value}",
    token_label: "Elemento {value}. Pulsa para quitarlo.",
    close: "Cerrar"
  }
};

let currentLanguage = localStorage.getItem("make10Language") || "en";

function t(key, vars = {}) {
  const table = translations[currentLanguage] || translations.en;
  let text = table[key] ?? translations.en[key] ?? key;

  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }

  return text;
}

function applyLanguage(lang) {
  if (!translations[lang]) return;

  currentLanguage = lang;
  localStorage.setItem("make10Language", lang);
  document.documentElement.lang = lang;

  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });

  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });

  if (backToMenuBtn) {
    backToMenuBtn.setAttribute("aria-label", t("menu"));
  }

  const closeHow = document.getElementById("closeHowBtn");
  if (closeHow) closeHow.setAttribute("aria-label", t("close"));
  if (numberRack) numberRack.setAttribute("aria-label", t("digits"));
  if (expression) expression.setAttribute("aria-label", t("expression"));

  renderNumbers();
  renderExpression();
  renderResult();
  updateHintButton();
}

document.querySelectorAll(".lang-btn").forEach(button => {
  button.addEventListener("click", () => {
    applyLanguage(button.dataset.lang);
  });
});


// ---------- Parser ----------

function tokenizeForParser() {
  return expressionTokens.map(token => ({
    type:
      token.type === "number"
        ? "number"
        : (token.value === "(" || token.value === ")")
          ? "paren"
          : "operator",
    value: token.value
  }));
}

function precedence(op) {
  if (op === "+" || op === "-") return 1;
  if (op === "*" || op === "/") return 2;
  return 0;
}

function toRPN(tokens) {
  const output = [];
  const ops = [];
  let previous = null;

  for (const token of tokens) {
    if (token.type === "number") {
      if (previous && (previous.type === "number" || previous.value === ")")) {
        throw new Error(t("err_between_numbers"));
      }

      output.push(token);
    } else if (token.type === "operator") {
      if (!previous || previous.type === "operator" || previous.value === "(") {
        throw new Error(t("err_operator"));
      }

      while (
        ops.length &&
        ops[ops.length - 1].type === "operator" &&
        precedence(ops[ops.length - 1].value) >= precedence(token.value)
      ) {
        output.push(ops.pop());
      }

      ops.push(token);
    } else if (token.value === "(") {
      if (previous && (previous.type === "number" || previous.value === ")")) {
        throw new Error(t("err_before_paren"));
      }

      ops.push(token);
    } else if (token.value === ")") {
      if (!previous || previous.type === "operator" || previous.value === "(") {
        throw new Error(t("err_bad_close"));
      }

      let foundLeftParen = false;

      while (ops.length) {
        const top = ops.pop();

        if (top.value === "(") {
          foundLeftParen = true;
          break;
        }

        output.push(top);
      }

      if (!foundLeftParen) {
        throw new Error(t("err_missing_open"));
      }
    }

    previous = token;
  }

  if (!previous) throw new Error(t("err_empty"));

  if (previous.type === "operator" || previous.value === "(") {
    throw new Error(t("err_incomplete"));
  }

  while (ops.length) {
    const top = ops.pop();

    if (top.value === "(" || top.value === ")") {
      throw new Error(t("err_incomplete"));
    }

    output.push(top);
  }

  return output;
}

function evaluateRPN(rpn) {
  const stack = [];

  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(Number(token.value));
      continue;
    }

    if (stack.length < 2) {
      throw new Error(t("err_invalid_expression"));
    }

    const b = stack.pop();
    const a = stack.pop();

    let result;

    if (token.value === "+") result = a + b;
    if (token.value === "-") result = a - b;
    if (token.value === "*") result = a * b;

    if (token.value === "/") {
      if (Math.abs(b) < 1e-12) {
        throw new Error(t("err_div_zero"));
      }

      result = a / b;
    }

    if (!Number.isFinite(result)) {
      throw new Error(t("err_invalid_result"));
    }

    stack.push(result);
  }

  if (stack.length !== 1) {
    throw new Error(t("err_invalid_expression"));
  }

  return stack[0];
}

function tryEvaluateExpression() {
  if (!expressionTokens.length) {
    return { ok: false, error: t("err_empty") };
  }

  try {
    const parserTokens = tokenizeForParser();
    const rpn = toRPN(parserTokens);
    const value = evaluateRPN(rpn);

    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}


// ---------- Hint economy ----------

function saveHintProgress() {
  localStorage.setItem("make10Hints", String(hints));
  localStorage.setItem("make10SolvedTotal", String(solvedTotal));
}

function prettySolution(expressionText) {
  if (!expressionText) return "";
  return expressionText
    .replaceAll("*", "×")
    .replaceAll("/", "÷");
}

function clearVisibleHint() {
  if (!hintTextEl || !hintPanel) return;

  hintTextEl.textContent = "";
  hintTextEl.classList.add("hidden");
  hintPanel.classList.remove("has-hint");
}

function showVisibleHint(text) {
  if (!hintTextEl || !hintPanel) return;

  hintTextEl.textContent = text;
  hintTextEl.classList.remove("hidden");
  hintPanel.classList.add("has-hint");

  // Restart the reveal animation when a new hint replaces the old one.
  hintTextEl.style.animation = "none";
  void hintTextEl.offsetWidth;
  hintTextEl.style.animation = "";
}

function updateHintButton() {
  if (!hintBtn || !hintCountEl) return;

  hintCountEl.textContent = String(hints);

  const steps = currentPuzzleSolution?.steps || [];
  const allRevealed = hintStepIndex > steps.length;

  hintBtn.disabled = solved || hints <= 0 || allRevealed;
}

function useHint() {
  if (solved) return;

  if (hints <= 0) {
    showVisibleHint(t("msg_no_hints"));
    updateHintButton();
    return;
  }

  if (!currentPuzzleSolution) {
    return;
  }

  const steps = currentPuzzleSolution.steps || [];

  if (hintStepIndex < steps.length) {
    hints -= 1;
    const stepText = steps[hintStepIndex];
    hintStepIndex += 1;

    saveHintProgress();
    updateHintButton();
    showVisibleHint(t("msg_hint", { step: stepText }));
    return;
  }

  if (hintStepIndex === steps.length) {
    hints -= 1;
    hintStepIndex += 1;

    saveHintProgress();
    updateHintButton();

    showVisibleHint(
      t("msg_hint_solution", {
        solution: `${prettySolution(currentPuzzleSolution.expression)} = 10`
      })
    );
    return;
  }

  showVisibleHint(t("msg_hint_used_up"));
  updateHintButton();
}


// ---------- Game actions ----------

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function checkSolution() {
  if (solved) return;

  const usedNumbers = expressionTokens.filter(token => token.type === "number");

  if (usedNumbers.length !== 4) {
    setMessage(t("msg_use_all"), "bad");
    return;
  }

  const uniqueIndexes = new Set(usedNumbers.map(token => token.sourceIndex));

  if (uniqueIndexes.size !== 4) {
    setMessage(t("msg_unique"), "bad");
    return;
  }

  const evaluated = tryEvaluateExpression();

  if (!evaluated.ok) {
    setMessage(evaluated.error, "bad");
    return;
  }

  if (Math.abs(evaluated.value - 10) < 1e-9) {
    solved = true;
    frozenElapsedMs = performance.now() - puzzleStartTime;
    streak += 1;
    solvedTotal += 1;

    let earnedHint = false;

    if (solvedTotal % 3 === 0) {
      hints += 1;
      earnedHint = true;
    }

    saveHintProgress();

    streakEl.textContent = String(streak);
    winTime.textContent = formatTime(frozenElapsedMs);

    setMessage(
      earnedHint ? t("msg_correct_bonus") : t("msg_correct"),
      "good"
    );

    render();

    if (window.Make10Audio) {
      window.Make10Audio.playSuccess();
    }

    sendScore();
  } else {
    const rounded = Math.round(evaluated.value * 10000) / 10000;
    setMessage(t("msg_got", { value: rounded }), "bad");
  }
}

function clearExpression() {
  if (solved) return;

  expressionTokens = [];
  setMessage("");
  render();
}

function undo() {
  if (solved || !expressionTokens.length) return;

  const removed = expressionTokens.pop();

  setMessage("");

  if (removed.type === "number") {
    renderWithReturnedNumberAnimation(removed.sourceIndex);
  } else {
    render();
  }
}

function startPuzzle({ keepStreak = true } = {}) {
  if (!keepStreak) {
    streak = 0;
  }

  solved = false;
  frozenElapsedMs = 0;
  puzzleStartTime = performance.now();

  const generatedPuzzle = generateSolvablePuzzle();
  puzzleNumbers = generatedPuzzle.numbers;
  currentPuzzleSolution = generatedPuzzle.solution;
  hintStepIndex = 0;

  expressionTokens = [];
  setMessage("");
  clearVisibleHint();

  render();
}

function nextPuzzle() {
  startPuzzle({ keepStreak: true });
}


checkBtn.addEventListener("click", checkSolution);
clearBtn.addEventListener("click", clearExpression);
undoBtn.addEventListener("click", undo);
hintBtn.addEventListener("click", useHint);
nextPuzzleBtn.addEventListener("click", nextPuzzle);

// ---------- Keyboard conveniences ----------

window.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    checkSolution();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undo();
  }

  if (event.key === "Escape") {
    clearExpression();
  }
});

// ---------- Boot ----------

saveHintProgress();
startPuzzle({ keepStreak: false });
requestAnimationFrame(timerLoop);
requestAnimationFrame(youtubeReady);


// ---------- Main menu ----------

const mainMenu = document.getElementById("mainMenu");
const gameView = document.getElementById("gameView");
const howToPlayModal = document.getElementById("howToPlayModal");
const startGameBtn = document.getElementById("startGameBtn");
const howToPlayBtn = document.getElementById("howToPlayBtn");
const closeHowBtn = document.getElementById("closeHowBtn");
const howStartBtn = document.getElementById("howStartBtn");
const backToMenuBtn = document.getElementById("backToMenuBtn");

let gameStartedFromMenu = false;
let menuPausedAt = null;

function showMainMenu() {
  // Если игрок уже начал игру, запоминаем момент ухода,
  // чтобы время в меню не засчитывалось в таймер задачи.
  if (gameStartedFromMenu && !solved && !gameView.classList.contains("hidden")) {
    menuPausedAt = performance.now();
  }

  mainMenu.classList.remove("hidden");
  gameView.classList.add("hidden");
  howToPlayModal.classList.add("hidden");
}

function startGameFromMenu() {
  mainMenu.classList.add("hidden");
  howToPlayModal.classList.add("hidden");
  gameView.classList.remove("hidden");

  if (!gameStartedFromMenu) {
    gameStartedFromMenu = true;
    puzzleStartTime = performance.now();
    frozenElapsedMs = 0;
    timerEl.textContent = "00:00";
  } else if (menuPausedAt !== null && !solved) {
    // Сдвигаем старт задачи на время, проведённое в меню.
    puzzleStartTime += performance.now() - menuPausedAt;
  }

  menuPausedAt = null;
}

function openHowToPlay() {
  howToPlayModal.classList.remove("hidden");
}

function closeHowToPlay() {
  howToPlayModal.classList.add("hidden");
}

startGameBtn.addEventListener("click", startGameFromMenu);
howToPlayBtn.addEventListener("click", openHowToPlay);
closeHowBtn.addEventListener("click", closeHowToPlay);
howStartBtn.addEventListener("click", startGameFromMenu);
backToMenuBtn.addEventListener("click", showMainMenu);

howToPlayModal.addEventListener("pointerdown", event => {
  if (event.target === howToPlayModal) {
    closeHowToPlay();
  }
});

window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !howToPlayModal.classList.contains("hidden")) {
    event.preventDefault();
    closeHowToPlay();
  }
});

applyLanguage(currentLanguage);
showMainMenu();
