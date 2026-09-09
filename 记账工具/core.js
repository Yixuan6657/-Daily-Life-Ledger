(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.LedgerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORAGE_VERSION = 1;

  var DEFAULT_CATEGORY_DEFS = [
    { id: "c-food", name: "餐饮", color: "#e05b48" },
    { id: "c-transit", name: "交通", color: "#2563eb" },
    { id: "c-study", name: "学习", color: "#7c5cbf" },
    { id: "c-shopping", name: "购物", color: "#d97917" },
    { id: "c-fun", name: "娱乐", color: "#dc4f78" },
    { id: "c-daily", name: "日用", color: "#0f8b75" },
    { id: "c-campus", name: "校园", color: "#0891b2" },
    { id: "c-other", name: "其他", color: "#697586" }
  ];

  var CUSTOM_COLORS = [
    "#3366cc",
    "#8f3e97",
    "#1f8a70",
    "#c2412e",
    "#b7791f",
    "#047a94",
    "#5f6b46",
    "#a04b8a"
  ];

  function cloneCategories(defs) {
    return defs.map(function (def) {
      return {
        id: def.id,
        name: def.name,
        color: def.color,
        builtin: true
      };
    });
  }

  function createInitialState(options) {
    options = options || {};
    var initialBalanceCents = toWholeNumber(options.initialBalanceCents, 0);
    var cycleStartDay = clampCycleDay(options.cycleStartDay);
    var onboarded = options.onboarded === true;

    return {
      version: STORAGE_VERSION,
      onboarded: onboarded,
      initialBalanceCents: initialBalanceCents,
      cycleStartDay: cycleStartDay,
      categories: cloneCategories(DEFAULT_CATEGORY_DEFS),
      transactions: [],
      updatedAt: Date.now()
    };
  }

  function toWholeNumber(value, fallback) {
    var numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return fallback;
    }
    return Math.round(numberValue);
  }

  function clampCycleDay(value) {
    var day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return 1;
    }
    return day;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateKeyForDate(date) {
    return (
      date.getFullYear() +
      "-" +
      pad(date.getMonth() + 1) +
      "-" +
      pad(date.getDate())
    );
  }

  function dateKeyToday() {
    return dateKeyForDate(new Date());
  }

  function parseDateKey(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) {
      return null;
    }
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function isValidDateKey(value) {
    return parseDateKey(value) !== null;
  }

  function addMonthsToDateKey(dateKey, monthOffset) {
    var parts = parseDateKey(dateKey);
    if (!parts) {
      return null;
    }
    return dateKeyForDate(
      new Date(parts.getFullYear(), parts.getMonth() + monthOffset, parts.getDate())
    );
  }

  function cycleStartKeyForDateKey(dateKey, startDay) {
    var date = parseDateKey(dateKey);
    if (!date) {
      return null;
    }
    var day = clampCycleDay(startDay);
    var monthOffset = date.getDate() >= day ? 0 : -1;
    return dateKeyForDate(
      new Date(date.getFullYear(), date.getMonth() + monthOffset, day)
    );
  }

  function cycleEndKeyForStartKey(startKey) {
    var start = parseDateKey(startKey);
    if (!start) {
      return null;
    }
    var end = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate() - 1);
    return dateKeyForDate(end);
  }

  function cycleBoundsForDateKey(dateKey, startDay) {
    var startKey = cycleStartKeyForDateKey(dateKey, startDay);
    return {
      startKey: startKey,
      endKey: cycleEndKeyForStartKey(startKey)
    };
  }

  function isDateKeyInRange(dateKey, startKey, endKey) {
    return dateKey >= startKey && dateKey <= endKey;
  }

  function summarizeCycle(state, startKey, endKey) {
    var allowances = 0;
    var expenses = 0;
    var categoryTotals = {};

    for (var i = 0; i < state.transactions.length; i++) {
      var tx = state.transactions[i];
      if (!isDateKeyInRange(tx.date, startKey, endKey)) {
        continue;
      }
      if (tx.type === "allowance") {
        allowances += tx.amountCents;
      } else if (tx.type === "expense") {
        expenses += tx.amountCents;
        categoryTotals[tx.categoryId] =
          (categoryTotals[tx.categoryId] || 0) + tx.amountCents;
      }
    }

    return {
      allowances: allowances,
      expenses: expenses,
      categoryTotals: categoryTotals
    };
  }

  function calculateBalance(state) {
    var balance = state.initialBalanceCents;
    for (var i = 0; i < state.transactions.length; i++) {
      var tx = state.transactions[i];
      if (tx.type === "allowance") {
        balance += tx.amountCents;
      } else if (tx.type === "expense") {
        balance -= tx.amountCents;
      }
    }
    return balance;
  }

  function shiftCycle(startKey, offset) {
    var start = parseDateKey(startKey);
    if (!start) {
      return startKey;
    }
    return dateKeyForDate(
      new Date(start.getFullYear(), start.getMonth() + offset, start.getDate())
    );
  }

  function createTransaction(record) {
    var now = Date.now();
    var categoryId =
      record.type === "expense" && record.categoryId ? record.categoryId : null;
    return {
      id: String(record.id || "t_" + now + "_" + Math.random().toString(36).slice(2, 8)),
      type: record.type === "allowance" ? "allowance" : "expense",
      amountCents: Math.max(1, toWholeNumber(record.amountCents, 1)),
      date: isValidDateKey(record.date) ? record.date : dateKeyToday(),
      categoryId: categoryId,
      note: String(record.note || ""),
      createdAt: Number(record.createdAt) || now
    };
  }

  function normalizeTransaction(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var type = raw.type === "allowance" ? "allowance" : "expense";
    var amount = toWholeNumber(raw.amountCents, 0);
    if (amount <= 0 || !isValidDateKey(raw.date)) {
      return null;
    }
    var tx = {
      id: String(raw.id || "tx_" + raw.date + "_" + amount),
      type: type,
      amountCents: amount,
      date: raw.date,
      categoryId: type === "expense" ? String(raw.categoryId || "c-other") : null,
      note: String(raw.note || "").slice(0, 120),
      createdAt: Number(raw.createdAt) || Date.now()
    };
    return tx;
  }

  function normalizeState(raw) {
    var source =
      raw && typeof raw === "object"
        ? raw
        : {
            initialBalanceCents: 0,
            cycleStartDay: 1,
            categories: [],
            transactions: []
          };

    var categories = [];
    var seenIds = {};
    if (Array.isArray(source.categories)) {
      for (var i = 0; i < source.categories.length; i++) {
        var category = source.categories[i];
        if (!category || typeof category !== "object" || !category.id || !category.name) {
          continue;
        }
        if (seenIds[category.id]) {
          continue;
        }
        seenIds[category.id] = true;
        categories.push({
          id: String(category.id),
          name: String(category.name).trim().slice(0, 8),
          color: typeof category.color === "string" ? category.color : "#697586",
          builtin: category.builtin === true
        });
      }
    }

    DEFAULT_CATEGORY_DEFS.forEach(function (def) {
      if (!seenIds[def.id]) {
        categories.push({
          id: def.id,
          name: def.name,
          color: def.color,
          builtin: true
        });
      }
    });

    var validCategoryIds = {};
    categories.forEach(function (category) {
      validCategoryIds[category.id] = true;
    });

    var transactions = [];
    if (Array.isArray(source.transactions)) {
      for (var j = 0; j < source.transactions.length; j++) {
        var normalized = normalizeTransaction(source.transactions[j]);
        if (!normalized) {
          continue;
        }
        if (
          normalized.type === "expense" &&
          !validCategoryIds[normalized.categoryId]
        ) {
          normalized.categoryId = "c-other";
        }
        transactions.push(normalized);
      }
    }

    var state = {
      version: STORAGE_VERSION,
      onboarded: source.onboarded !== false,
      initialBalanceCents: toWholeNumber(source.initialBalanceCents, 0),
      cycleStartDay: clampCycleDay(source.cycleStartDay),
      categories: categories,
      transactions: transactions,
      updatedAt: Number(source.updatedAt) || Date.now()
    };

    if (state.initialBalanceCents < 0) {
      state.initialBalanceCents = 0;
    }
    return state;
  }

  function moveTransactionsToOther(state) {
    var other = state.categories.filter(function (category) {
      return category.id === "c-other";
    })[0];
    if (!other) {
      var otherCategory = cloneCategories([
        { id: "c-other", name: "其他", color: "#697586" }
      ])[0];
      state.categories.push(otherCategory);
    }
  }

  function assignCustomColor(index) {
    return CUSTOM_COLORS[index % CUSTOM_COLORS.length];
  }

  return {
    STORAGE_VERSION: STORAGE_VERSION,
    DEFAULT_CATEGORY_DEFS: DEFAULT_CATEGORY_DEFS,
    CUSTOM_COLORS: CUSTOM_COLORS,
    createInitialState: createInitialState,
    normalizeState: normalizeState,
    normalizeTransaction: normalizeTransaction,
    createTransaction: createTransaction,
    dateKeyForDate: dateKeyForDate,
    dateKeyToday: dateKeyToday,
    parseDateKey: parseDateKey,
    isValidDateKey: isValidDateKey,
    addMonthsToDateKey: addMonthsToDateKey,
    cycleStartKeyForDateKey: cycleStartKeyForDateKey,
    cycleEndKeyForStartKey: cycleEndKeyForStartKey,
    cycleBoundsForDateKey: cycleBoundsForDateKey,
    isDateKeyInRange: isDateKeyInRange,
    summarizeCycle: summarizeCycle,
    calculateBalance: calculateBalance,
    shiftCycle: shiftCycle,
    moveTransactionsToOther: moveTransactionsToOther,
    assignCustomColor: assignCustomColor
  };
});
