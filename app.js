
"use strict";

const DB_NAME = "MiBalanceDB";
const DB_VERSION = 1;
const STORE = "movements";
const BACKUP_VERSION = 1;

const CATEGORIES = {
  gasto: [
    "Alimentos y supermercado",
    "Vivienda",
    "Servicios",
    "Transporte",
    "Salud",
    "Educación",
    "Restaurantes",
    "Compras personales",
    "Entretenimiento",
    "Trabajo",
    "Otros gastos"
  ],
  ingreso: [
    "Sueldo",
    "Honorarios",
    "Negocio",
    "Rendimientos",
    "Reembolso",
    "Otros ingresos"
  ]
};

const $ = (id) => document.getElementById(id);

const form = $("movementForm");
const typeInput = $("type");
const amountInput = $("amount");
const categoryInput = $("category");
const dateInput = $("date");
const conceptInput = $("concept");
const paymentInput = $("paymentMethod");
const movementIdInput = $("movementId");
const saveButton = $("saveButton");
const cancelEditButton = $("cancelEdit");
const movementList = $("movementList");
const emptyMessage = $("emptyMessage");
const formMessage = $("formMessage");
const backupMessage = $("backupMessage");

let db = null;
let movements = [];
let databaseReady = false;

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN"
});

function formatMoney(cents) {
  return money.format(cents / 100);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthString() {
  return localDateString().slice(0, 7);
}

function formatDate(value) {
  const parts = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

function newId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `message ${type}`.trim();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Este navegador no admite IndexedDB."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, {
          keyPath: "id"
        });
        store.createIndex("date", "date", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error || new Error("No se pudo abrir la base local.")
    );

    request.onblocked = () => {
      console.warn("Cierra otras pestañas de Mi Balance y vuelve a intentar.");
    };
  });
}

function getAllMovements() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveMovement(movement) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(movement);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(
      transaction.error || new Error("No se guardó el movimiento.")
    );
  });
}

function deleteMovement(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(
      transaction.error || new Error("No se eliminó el movimiento.")
    );
  });
}

function replaceAllMovements(records) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);

    store.clear();
    records.forEach((record) => store.put(record));

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(
      transaction.error || new Error("No se pudo restaurar el respaldo.")
    );
  });
}

function refreshCategoryOptions(selected = "") {
  const type = typeInput.value;
  const options = CATEGORIES[type];

  categoryInput.replaceChildren();

  options.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryInput.append(option);
  });

  if (selected && options.includes(selected)) {
    categoryInput.value = selected;
  }
}

function getMovementTotals(records) {
  return records.reduce((totals, record) => {
    if (record.type === "ingreso") {
      totals.income += record.amountCents;
    } else {
      totals.expenses += record.amountCents;
    }

    return totals;
  }, { income: 0, expenses: 0 });
}

function renderSummary() {
  const totals = getMovementTotals(movements);
  const month = currentMonthString();

  const monthRecords = movements.filter(
    (record) => record.date.startsWith(month)
  );

  const monthTotals = getMovementTotals(monthRecords);
  const balance = totals.income - totals.expenses;

  $("currentBalance").textContent = formatMoney(balance);
  $("monthIncome").textContent = formatMoney(monthTotals.income);
  $("monthExpenses").textContent = formatMoney(monthTotals.expenses);

  $("currentPeriod").textContent =
    `Balance acumulado de todos los movimientos · ` +
    `${movements.length} registro(s)`;

  $("currentBalance").classList.toggle("negative", balance < 0);
  $("currentBalance").classList.toggle("positive", balance >= 0);
}

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;

  if (className) {
    cell.className = className;
  }

  return cell;
}

function createActionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = `small-button ${className}`.trim();
  button.addEventListener("click", handler);
  return button;
}

function renderHistory() {
  const selectedMonth = $("filterMonth").value;
  const selectedType = $("filterType").value;
  const query = $("searchText").value.trim().toLocaleLowerCase("es-MX");

  const filtered = movements
    .filter((record) => {
      if (selectedMonth && !record.date.startsWith(selectedMonth)) {
        return false;
      }

      if (selectedType !== "todos" && record.type !== selectedType) {
        return false;
      }

      const searchable = [
        record.concept,
        record.category,
        record.paymentMethod
      ].join(" ").toLocaleLowerCase("es-MX");

      return searchable.includes(query);
    })
    .sort((a, b) => b.date.localeCompare(a.date) ||
      b.createdAt.localeCompare(a.createdAt));

  movementList.replaceChildren();

  filtered.forEach((record) => {
    const row = document.createElement("tr");

    row.append(createCell(formatDate(record.date)));

    const description = record.concept || "(Sin concepto)";
    const typeLabel = record.type === "ingreso" ? "Ingreso" : "Gasto";
    row.append(createCell(`${typeLabel}: ${description}`));
    row.append(createCell(record.category));
    row.append(createCell(record.paymentMethod));

    const amountClass = record.type === "ingreso"
      ? "numeric amount-income"
      : "numeric amount-expense";

    const sign = record.type === "ingreso" ? "+" : "−";
    row.append(createCell(
      `${sign}${formatMoney(record.amountCents)}`,
      amountClass
    ));

    const actions = document.createElement("td");
    const actionGroup = document.createElement("div");
    actionGroup.className = "row-actions";

    actionGroup.append(createActionButton("Editar", "", () => {
      startEdit(record.id);
    }));

    actionGroup.append(createActionButton("Eliminar", "delete", async () => {
      await removeRecord(record.id);
    }));

    actions.append(actionGroup);
    row.append(actions);
    movementList.append(row);
  });

  emptyMessage.hidden = filtered.length > 0;
  emptyMessage.textContent = filtered.length
    ? ""
    : movements.length
      ? "No hay movimientos que coincidan con los filtros."
      : "Todavía no hay movimientos registrados.";

  $("historyCount").textContent =
    `${filtered.length} movimiento(s) mostrado(s) de ${movements.length}.`;
}

async function reloadData() {
  movements = await getAllMovements();
  renderSummary();
  renderHistory();
}

function resetForm() {
  form.reset();
  movementIdInput.value = "";
  typeInput.value = "gasto";
  dateInput.value = localDateString();
  refreshCategoryOptions();
  saveButton.textContent = "Guardar movimiento";
  cancelEditButton.hidden = true;
  $("formTitle").textContent = "Registrar movimiento";
}

function startEdit(id) {
  const record = movements.find((item) => item.id === id);
  if (!record) return;

  movementIdInput.value = record.id;
  typeInput.value = record.type;
  refreshCategoryOptions(record.category);
  amountInput.value = (record.amountCents / 100).toFixed(2);
  categoryInput.value = record.category;
  dateInput.value = record.date;
  conceptInput.value = record.concept;
  paymentInput.value = record.paymentMethod;

  saveButton.textContent = "Guardar cambios";
  cancelEditButton.hidden = false;
  $("formTitle").textContent = "Editar movimiento";
  setMessage(formMessage, "Edita los datos y guarda los cambios.");
  $("formTitle").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function removeRecord(id) {
  const record = movements.find((item) => item.id === id);
  if (!record) return;

  const confirmed = window.confirm(
    `¿Eliminar este movimiento de ${formatMoney(record.amountCents)}?`
  );

  if (!confirmed) return;

  try {
    await deleteMovement(id);

    if (movementIdInput.value === id) {
      resetForm();
    }

    await reloadData();
    setMessage(formMessage, "Movimiento eliminado.", "success");
  } catch (error) {
    console.error(error);
    setMessage(formMessage, "No se pudo eliminar el movimiento.", "error");
  }
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

function validateMovement(record) {
  return record &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    ["ingreso", "gasto"].includes(record.type) &&
    Number.isSafeInteger(record.amountCents) &&
    record.amountCents > 0 &&
    isValidDate(record.date) &&
    typeof record.category === "string" &&
    record.category.length > 0 &&
    typeof record.concept === "string" &&
    typeof record.paymentMethod === "string" &&
    record.paymentMethod.length > 0 &&
    typeof record.createdAt === "string";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!databaseReady) return;

  const rawAmount = Number(amountInput.value);
  const amountCents = Math.round(rawAmount * 100);

  if (!Number.isFinite(rawAmount) ||
      rawAmount <= 0 ||
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0) {
    setMessage(formMessage, "Ingresa un importe válido mayor que cero.", "error");
    return;
  }

  if (!isValidDate(dateInput.value)) {
    setMessage(formMessage, "Selecciona una fecha válida.", "error");
    return;
  }

  const existingId = movementIdInput.value;
  const previous = movements.find((record) => record.id === existingId);

  const record = {
    id: existingId || newId(),
    type: typeInput.value,
    amountCents,
    category: categoryInput.value,
    date: dateInput.value,
    concept: conceptInput.value.trim(),
    paymentMethod: paymentInput.value,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!validateMovement(record)) {
    setMessage(formMessage, "Revisa los campos del movimiento.", "error");
    return;
  }

  saveButton.disabled = true;

  try {
    await saveMovement(record);
    await reloadData();
    resetForm();

    setMessage(
      formMessage,
      existingId ? "Cambios guardados correctamente." :
        "Movimiento registrado correctamente.",
      "success"
    );
  } catch (error) {
    console.error(error);
    setMessage(formMessage, "No se pudo guardar. Revisa el espacio disponible.", "error");
  } finally {
    saveButton.disabled = false;
  }
});

typeInput.addEventListener("change", () => refreshCategoryOptions());
cancelEditButton.addEventListener("click", () => {
  resetForm();
  setMessage(formMessage, "Edición cancelada.");
});

$("filterMonth").addEventListener("change", renderHistory);
$("filterType").addEventListener("change", renderHistory);
$("searchText").addEventListener("input", renderHistory);

$("exportButton").addEventListener("click", async () => {
  try {
    const records = await getAllMovements();

    const backup = {
      app: "Mi Balance",
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      currency: "MXN",
      movements: records
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mi-balance-respaldo-${localDateString()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setMessage(backupMessage, "Respaldo preparado para guardar.", "success");
  } catch (error) {
    console.error(error);
    setMessage(backupMessage, "No se pudo exportar el respaldo.", "error");
  }
});

$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    if (file.size > 20 * 1024 * 1024) {
      throw new Error("El archivo supera el límite de 20 MB.");
    }

    const text = await file.text();
    const backup = JSON.parse(text);

    if (
      !backup ||
      backup.app !== "Mi Balance" ||
      backup.version !== BACKUP_VERSION ||
      backup.currency !== "MXN" ||
      !Array.isArray(backup.movements)
    ) {
      throw new Error("El archivo no tiene el formato de respaldo esperado.");
    }

    if (!backup.movements.every(validateMovement)) {
      throw new Error("Hay movimientos inválidos en el archivo.");
    }

    const ids = backup.movements.map((record) => record.id);
    if (new Set(ids).size !== ids.length) {
      throw new Error("El respaldo contiene identificadores duplicados.");
    }

    const confirmed = window.confirm(
      `El archivo contiene ${backup.movements.length} movimientos. ` +
      "La restauración reemplazará TODOS los movimientos actuales. " +
      "¿Deseas continuar?"
    );

    if (!confirmed) {
      setMessage(backupMessage, "Restauración cancelada.");
      return;
    }

    await replaceAllMovements(backup.movements);
    await reloadData();
    resetForm();

    setMessage(
      backupMessage,
      `Respaldo restaurado: ${backup.movements.length} movimiento(s).`,
      "success"
    );
  } catch (error) {
    console.error(error);
    setMessage(
      backupMessage,
      error instanceof SyntaxError
        ? "El archivo no contiene JSON válido."
        : error.message || "No se pudo restaurar el respaldo.",
      "error"
    );
  } finally {
    event.target.value = "";
  }
});

async function init() {
  dateInput.value = localDateString();
  $("filterMonth").value = currentMonthString();
  refreshCategoryOptions();

  try {
    db = await openDatabase();
    databaseReady = true;
    await reloadData();
  } catch (error) {
    console.error(error);
    setMessage(
      formMessage,
      "No se pudo iniciar el almacenamiento local. Prueba con un navegador actualizado.",
      "error"
    );

    saveButton.disabled = true;
    $("exportButton").disabled = true;
    $("importFile").disabled = true;
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("La aplicación funciona, pero no se activó la caché offline.", error);
    });
  }
}

init();
