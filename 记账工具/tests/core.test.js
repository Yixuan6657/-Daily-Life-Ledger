const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

function sampleState(options) {
  const state = core.createInitialState(options);
  state.transactions = [];
  return state;
}

function pushTransaction(state, record) {
  state.transactions.push(core.createTransaction(record));
}

test("default cycle follows calendar month boundaries", () => {
  const bounds = core.cycleBoundsForDateKey("2026-09-09", 1);
  assert.equal(bounds.startKey, "2026-09-01");
  assert.equal(bounds.endKey, "2026-09-30");
  assert.equal(core.cycleBoundsForDateKey("2026-09-30", 1).endKey, "2026-09-30");
  assert.equal(core.cycleBoundsForDateKey("2026-10-01", 1).startKey, "2026-10-01");
});

test("custom cycle starts on configured day and splits adjacent dates", () => {
  const before = core.cycleBoundsForDateKey("2026-09-04", 5);
  const after = core.cycleBoundsForDateKey("2026-09-05", 5);
  assert.equal(before.startKey, "2026-08-05");
  assert.equal(before.endKey, "2026-09-04");
  assert.equal(after.startKey, "2026-09-05");
  assert.equal(after.endKey, "2026-10-04");
});

test("balance and cycle totals are calculated from the ledger", () => {
  const state = sampleState({ initialBalanceCents: 100000 });
  pushTransaction(state, {
    type: "allowance",
    amountCents: 150000,
    date: "2026-09-02",
    note: "九月生活费"
  });
  pushTransaction(state, {
    type: "expense",
    amountCents: 2000,
    date: "2026-09-05",
    categoryId: "c-food"
  });
  pushTransaction(state, {
    type: "expense",
    amountCents: 5000,
    date: "2026-10-01",
    categoryId: "c-transit"
  });

  const summary = core.summarizeCycle(state, "2026-09-01", "2026-09-30");
  assert.equal(summary.allowances, 150000);
  assert.equal(summary.expenses, 2000);
  assert.equal(summary.categoryTotals["c-food"], 2000);
  assert.equal(core.calculateBalance(state), 243000);
});

test("normalization repairs missing and invalid transaction data", () => {
  const normalized = core.normalizeState({
    version: 1,
    onboarded: true,
    initialBalanceCents: "10000",
    cycleStartDay: 9,
    categories: [{ id: "c-other", name: "其他", color: "#697586", builtin: true }],
    transactions: [
      {
        type: "expense",
        amountCents: 1200,
        date: "2026-09-09",
        categoryId: "missing-category"
      },
      {
        type: "expense",
        amountCents: -1,
        date: "2026-09-09"
      }
    ]
  });

  assert.equal(normalized.cycleStartDay, 9);
  assert.equal(normalized.initialBalanceCents, 10000);
  assert.ok(normalized.categories.some((category) => category.id === "c-other"));
  assert.equal(normalized.transactions.length, 1);
  assert.equal(normalized.transactions[0].categoryId, "c-other");
});

test("cycle navigation shifts by one cycle", () => {
  assert.equal(core.shiftCycle("2026-09-05", -1), "2026-08-05");
  assert.equal(core.shiftCycle("2026-09-05", 1), "2026-10-05");
  assert.equal(core.shiftCycle("2026-01-28", -1), "2025-12-28");
});
