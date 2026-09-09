(function () {
  "use strict";

  const CORE = window.LedgerCore;
  const STORAGE_KEY = "university-expense-ledger-v1";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root) =>
    Array.from((root || document).querySelectorAll(selector));

  const ICON_PATHS = {
    plus: '<path d="M12 5v14M5 12h14" />',
    x: '<path d="M18 6 6 18M6 6l12 12" />',
    settings:
      '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4" />',
    "chevron-left": '<path d="m15 18-6-6 6-6" />',
    "chevron-right": '<path d="m9 18 6-6-6-6" />',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />',
    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />',
    receipt:
      '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z" /><path d="M9 7h6M9 12h6" />'
  };

  const GLYPH_MAP = {
    "c-food": "餐",
    "c-transit": "行",
    "c-study": "书",
    "c-shopping": "购",
    "c-fun": "乐",
    "c-daily": "日",
    "c-campus": "校",
    "c-other": "其"
  };

  let state = null;
  let selectedCycleStartKey = null;
  let entryType = "expense";
  let editingId = null;
  let selectedCategoryId = null;
  let toastTimer = null;

  function icon(name, size) {
    const width = size || 18;
    return (
      '<svg class="icon" width="' +
      width +
      '" height="' +
      width +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICON_PATHS[name] || "") +
      "</svg>"
    );
  }

  function hydrateIcons(root) {
    $$("[data-icon]", root).forEach((element) => {
      if (element.dataset.iconDone === "1") {
        return;
      }
      element.insertAdjacentHTML("afterbegin", icon(element.dataset.icon));
      element.dataset.iconDone = "1";
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (character) => {
        const entities = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        };
        return entities[character];
      }
    );
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "")) ? value : "#697586";
  }

  function formatAmount(cents) {
    const isNegative = cents < 0;
    const absolute = Math.abs(cents);
    const numberText = (absolute / 100).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return (isNegative ? "-" : "") + "¥" + numberText;
  }

  function centsToInput(cents) {
    return (cents / 100).toFixed(2);
  }

  function parseAmountInput(value, allowZero) {
    const cleaned = String(value || "")
      .trim()
      .replace(/[,，\s¥￥]/g, "");
    if (cleaned === "") {
      return allowZero ? 0 : null;
    }
    const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(cleaned);
    if (!match) {
      return null;
    }
    const cents = Math.round(Number(cleaned) * 100);
    if (!Number.isSafeInteger(cents) || cents < 0) {
      return null;
    }
    if (!allowZero && cents === 0) {
      return null;
    }
    return cents;
  }

  function categoryById(id) {
    if (!state || !id) {
      return null;
    }
    return (
      state.categories.find((category) => category.id === id) || null
    );
  }

  function glyphForCategory(category) {
    if (!category) {
      return "其";
    }
    return GLYPH_MAP[category.id] || String(category.name || "?").trim().slice(0, 1) || "类";
  }

  function currentCycleStartKey() {
    return CORE.cycleStartKeyForDateKey(
      CORE.dateKeyToday(),
      state.cycleStartDay
    );
  }

  function getCycleEndKey() {
    return CORE.cycleEndKeyForStartKey(selectedCycleStartKey);
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 1800);
  }

  function readState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? CORE.normalizeState(JSON.parse(stored)) : null;
    } catch (error) {
      return null;
    }
  }

  function persistState() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      showToast("数据保存失败");
    }
  }

  function formatCycleLabel(startKey, endKey) {
    const start = CORE.parseDateKey(startKey);
    const end = CORE.parseDateKey(endKey);
    if (!start || !end) {
      return "--";
    }
    const startMonth = start.getMonth() + 1;
    const endMonth = end.getMonth() + 1;
    if (start.getFullYear() === end.getFullYear()) {
      return (
        startMonth + "月" + start.getDate() + "日 - " +
        endMonth + "月" + end.getDate() + "日"
      );
    }
    return (
      start.getFullYear() + "年" + startMonth + "月" + start.getDate() + "日 - " +
      end.getFullYear() + "年" + endMonth + "月" + end.getDate() + "日"
    );
  }

  function dateDisplay(dateKey) {
    const date = CORE.parseDateKey(dateKey);
    const todayKey = CORE.dateKeyToday();
    const today = CORE.parseDateKey(todayKey);
    if (!date || !today) {
      return "";
    }
    if (dateKey === todayKey) {
      return "今天";
    }
    const yesterday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - 1
    );
    if (
      dateKey ===
      CORE.dateKeyForDate(
        new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())
      )
    ) {
      return "昨天";
    }
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const base =
      date.getMonth() +
      1 +
      "月" +
      date.getDate() +
      "日 " +
      weekdays[date.getDay()];
    if (date.getFullYear() !== today.getFullYear()) {
      return date.getFullYear() + "年" + base;
    }
    return base;
  }

  function renderMetrics(startKey, endKey) {
    const balance = CORE.calculateBalance(state);
    const cycle = CORE.summarizeCycle(state, startKey, endKey);
    const balanceValue = $("balanceValue");
    balanceValue.textContent = formatAmount(balance);
    balanceValue.classList.toggle("is-negative", balance < 0);
    $("allowanceValue").textContent = formatAmount(cycle.allowances);
    $("spentValue").textContent = formatAmount(cycle.expenses);
  }

  function renderPeriod() {
    const endKey = getCycleEndKey();
    $("cycleLabel").textContent = formatCycleLabel(
      selectedCycleStartKey,
      endKey
    );
    const isCurrent = selectedCycleStartKey === currentCycleStartKey();
    const tag = $("cycleTag");
    tag.textContent = isCurrent ? "当前周期" : "";
  }

  function renderCategoryStats(startKey, endKey) {
    const summary = CORE.summarizeCycle(state, startKey, endKey);
    const entries = Object.keys(summary.categoryTotals)
      .map((categoryId) => ({
        category: categoryById(categoryId) || {
          id: "c-other",
          name: "其他",
          color: "#697586"
        },
        amount: summary.categoryTotals[categoryId]
      }))
      .filter((entry) => entry.amount > 0)
      .sort((left, right) => right.amount - left.amount);

    const container = $("categoryStats");
    if (entries.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><span class="empty-mark">' +
        icon("receipt") +
        "</span><p>这个周期还没有支出</p></div>";
      return;
    }

    const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
    container.innerHTML = entries
      .map((entry) => {
        const color = safeColor(entry.category.color);
        const percent = Math.round((entry.amount / total) * 100);
        const width = Math.max(2, Math.min(100, percent));
        return (
          '<div class="category-stat">' +
          '<span class="cat-glyph" style="background:' +
          color +
          '">' +
          escapeHtml(glyphForCategory(entry.category)) +
          "</span>" +
          '<div class="category-stat-main">' +
          '<div class="category-stat-name">' +
          escapeHtml(entry.category.name) +
          "</div>" +
          '<div class="stat-track" role="img" aria-label="' +
          escapeHtml(entry.category.name + " 占比 " + percent + "%") +
          '"><span class="stat-fill" style="width:' +
          width +
          "%;background:" +
          color +
          '"></span></div>' +
          "</div>" +
          '<div class="category-stat-number"><strong>' +
          formatAmount(entry.amount) +
          "</strong>" +
          percent +
          "%</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function daySubtotalText(records) {
    let allowances = 0;
    let expenses = 0;
    records.forEach((record) => {
      if (record.type === "allowance") {
        allowances += record.amountCents;
      } else {
        expenses += record.amountCents;
      }
    });
    const parts = [];
    if (expenses > 0) {
      parts.push("支出 " + formatAmount(expenses));
    }
    if (allowances > 0) {
      parts.push("入账 " + formatAmount(allowances));
    }
    return parts.join(" · ");
  }

  function renderTransactions(startKey, endKey) {
    const records = state.transactions
      .filter((record) =>
        CORE.isDateKeyInRange(record.date, startKey, endKey)
      )
      .sort((left, right) => {
        if (left.date !== right.date) {
          return left.date < right.date ? 1 : -1;
        }
        return right.createdAt - left.createdAt;
      });

    const container = $("transactionList");
    if (records.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><span class="empty-mark">' +
        icon("receipt") +
        "</span><p>这个周期还没有账单</p></div>";
      return;
    }

    const groups = [];
    records.forEach((record) => {
      const last = groups[groups.length - 1];
      if (!last || last.dateKey !== record.date) {
        groups.push({ dateKey: record.date, records: [] });
      }
      groups[groups.length - 1].records.push(record);
    });

    container.innerHTML = groups
      .map((group) => {
        const rows = group.records
          .map((record) => {
            const isIncome = record.type === "allowance";
            const category = isIncome
              ? { id: "income", name: "生活费到账", color: "#0d7668" }
              : categoryById(record.categoryId) || {
                  id: "c-other",
                  name: "其他",
                  color: "#697586"
                };
            const color = safeColor(category.color);
            const note =
              record.note && record.note.trim()
                ? '<div class="tx-note">' + escapeHtml(record.note) + "</div>"
                : "";
            return (
              '<button class="tx-row" type="button" data-record-id="' +
              escapeHtml(record.id) +
              '">' +
              '<span class="tx-glyph" style="background:' +
              color +
              '">' +
              escapeHtml(isIncome ? "入" : glyphForCategory(category)) +
              "</span>" +
              '<span class="tx-main">' +
              '<span class="tx-title">' +
              escapeHtml(isIncome ? "生活费到账" : category.name) +
              "</span>" +
              note +
              "</span>" +
              '<span class="tx-amount' +
              (isIncome ? " is-income" : "") +
              '">' +
              (isIncome ? "+" : "-") +
              formatAmount(record.amountCents) +
              "</span>" +
              "</button>"
            );
          })
          .join("");

        return (
          '<div class="day-group">' +
          '<div class="day-head"><span class="day-title">' +
          escapeHtml(dateDisplay(group.dateKey)) +
          "</span><span class=\"day-subtotal\">" +
          escapeHtml(daySubtotalText(group.records)) +
          "</span></div>" +
          rows +
          "</div>"
        );
      })
      .join("");
  }

  function renderAll() {
    const startKey =
      selectedCycleStartKey || currentCycleStartKey();
    selectedCycleStartKey = startKey;
    const endKey = getCycleEndKey();
    renderPeriod();
    renderMetrics(startKey, endKey);
    renderCategoryStats(startKey, endKey);
    renderTransactions(startKey, endKey);
  }

  function populateCycleSelects() {
    const selects = [$("cycleStartDayInput"), $("onboardCycleDayInput")];
    selects.forEach((select) => {
      select.innerHTML = "";
      for (let day = 1; day <= 28; day++) {
        const option = document.createElement("option");
        option.value = String(day);
        option.textContent = String(day) + " 号";
        select.appendChild(option);
      }
    });
  }

  function setModalLock(locked) {
    document.body.style.overflow = locked ? "hidden" : "";
  }

  function setTypeButtons(type) {
    $$("#entryTypeSwitch button").forEach((button) => {
      const active = button.dataset.type === type;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function lastUsedCategoryId() {
    for (let index = state.transactions.length - 1; index >= 0; index--) {
      const record = state.transactions[index];
      if (
        record.type === "expense" &&
        categoryById(record.categoryId)
      ) {
        return record.categoryId;
      }
    }
    return null;
  }

  function renderCategoryPicker(selectedId) {
    selectedCategoryId = selectedId || null;
    const picker = $("categoryPicker");
    picker.innerHTML = "";
    state.categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.categoryId = category.id;
      button.classList.toggle("active", category.id === selectedCategoryId);
      button.innerHTML =
        '<span class="cat-glyph" style="background:' +
        safeColor(category.color) +
        '">' +
        escapeHtml(glyphForCategory(category)) +
        "</span><span>" +
        escapeHtml(category.name) +
        "</span>";
      picker.appendChild(button);
    });
    updateSaveButtonState();
  }

  function updateSaveButtonState() {
    const amount = parseAmountInput($("amountInput").value, false);
    const amountValid = amount !== null && amount > 0;
    const categoryValid =
      entryType === "allowance" ||
      Boolean(selectedCategoryId && categoryById(selectedCategoryId));
    $("saveEntryBtn").disabled = !(amountValid && categoryValid);
  }

  function setCategoryFieldVisible() {
    $("categoryField").hidden = entryType === "allowance";
  }

  function openEntryModal() {
    editingId = null;
    entryType = "expense";
    selectedCategoryId = null;
    $("amountInput").value = "";
    $("noteInput").value = "";
    $("dateInput").value = CORE.dateKeyToday();
    $("dateInput").max = CORE.dateKeyToday();
    $("deleteEntryWrap").hidden = true;
    $("entryTitle").textContent = "记一笔";
    setTypeButtons("expense");
    setCategoryFieldVisible();
    renderCategoryPicker(lastUsedCategoryId());
    $("entryOverlay").hidden = false;
    setModalLock(true);
    $("amountInput").focus();
  }

  function openEditModal(recordId) {
    const record = state.transactions.find((item) => item.id === recordId);
    if (!record) {
      return;
    }
    editingId = record.id;
    entryType = record.type;
    selectedCategoryId =
      record.type === "expense" ? record.categoryId : null;
    $("amountInput").value = centsToInput(record.amountCents);
    $("noteInput").value = record.note || "";
    $("dateInput").value = record.date;
    $("dateInput").max = CORE.dateKeyToday();
    $("deleteEntryWrap").hidden = false;
    $("entryTitle").textContent = "编辑记录";
    setTypeButtons(entryType);
    setCategoryFieldVisible();
    renderCategoryPicker(selectedCategoryId);
    $("entryOverlay").hidden = false;
    setModalLock(true);
    $("amountInput").focus();
  }

  function closeEntryModal() {
    $("entryOverlay").hidden = true;
    setModalLock(false);
    editingId = null;
    entryType = "expense";
    selectedCategoryId = null;
  }

  function saveEntry(event) {
    event.preventDefault();
    const amount = parseAmountInput($("amountInput").value, false);
    if (amount === null) {
      showToast("请输入正确的金额");
      $("amountInput").focus();
      return;
    }
    const date = $("dateInput").value;
    if (!date || date > CORE.dateKeyToday()) {
      showToast("不能选择未来日期");
      return;
    }
    if (entryType === "expense" && !categoryById(selectedCategoryId)) {
      showToast("请选择分类");
      return;
    }

    const note = $("noteInput").value.trim();
    const categoryId =
      entryType === "expense" ? selectedCategoryId : null;
    const now = Date.now();

    if (editingId) {
      const record = state.transactions.find((item) => item.id === editingId);
      if (record) {
        record.type = entryType;
        record.amountCents = amount;
        record.date = date;
        record.categoryId = categoryId;
        record.note = note;
        record.createdAt = now;
      }
    } else {
      state.transactions.push(
        CORE.createTransaction({
          type: entryType,
          amountCents: amount,
          date: date,
          categoryId: categoryId,
          note: note,
          createdAt: now
        })
      );
    }

    persistState();
    renderAll();
    closeEntryModal();
    showToast("已保存");
  }

  function deleteEditingRecord() {
    if (!editingId) {
      return;
    }
    const record = state.transactions.find((item) => item.id === editingId);
    if (!record) {
      return;
    }
    if (!window.confirm("确定删除这条记录吗？")) {
      return;
    }
    state.transactions = state.transactions.filter(
      (item) => item.id !== editingId
    );
    persistState();
    renderAll();
    closeEntryModal();
    showToast("已删除");
  }

  function renderCategoryManager() {
    const manager = $("categoryManager");
    manager.innerHTML = "";
    state.categories.forEach((category) => {
      const item = document.createElement("div");
      item.className = "category-manager-item";
      let trailing = "";
      if (category.builtin) {
        trailing = '<span class="builtin-label">默认</span>';
      } else {
        trailing =
          '<button class="category-remove" type="button" data-remove-category="' +
          escapeHtml(category.id) +
          '" aria-label="删除分类 ' +
          escapeHtml(category.name) +
          '">' +
          icon("x", 14) +
          "</button>";
      }
      item.innerHTML =
        '<span class="cat-glyph" style="background:' +
        safeColor(category.color) +
        '">' +
        escapeHtml(glyphForCategory(category)) +
        "</span>" +
        '<span class="category-manager-name">' +
        escapeHtml(category.name) +
        "</span>" +
        trailing;
      manager.appendChild(item);
    });
  }

  function addCategory() {
    const input = $("newCategoryInput");
    const name = input.value.trim();
    if (!name) {
      showToast("请输入分类名");
      return;
    }
    const duplicate = state.categories.some(
      (category) => category.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      showToast("已有同名分类");
      return;
    }
    const customCount = state.categories.filter(
      (category) => !category.builtin
    ).length;
    const category = {
      id: "custom_" + Date.now().toString(36),
      name: name.slice(0, 8),
      color: CORE.assignCustomColor(customCount),
      builtin: false
    };
    state.categories.push(category);
    input.value = "";
    persistState();
    renderCategoryManager();
    renderAll();
    showToast("已添加分类");
  }

  function removeCategory(categoryId) {
    const category = categoryById(categoryId);
    if (!category || category.builtin) {
      return;
    }
    const usedCount = state.transactions.filter(
      (record) => record.type === "expense" && record.categoryId === categoryId
    ).length;
    const message =
      usedCount > 0
        ? "分类“" +
          category.name +
          "”下有 " +
          usedCount +
          " 条记录，删除后会自动归入“其他”。确定删除吗？"
        : "确定删除分类“" + category.name + "”吗？";
    if (!window.confirm(message)) {
      return;
    }
    state.categories = state.categories.filter(
      (item) => item.id !== categoryId
    );
    state.transactions.forEach((record) => {
      if (record.type === "expense" && record.categoryId === categoryId) {
        record.categoryId = "c-other";
      }
    });
    if (selectedCategoryId === categoryId) {
      selectedCategoryId = "c-other";
    }
    CORE.moveTransactionsToOther(state);
    persistState();
    renderCategoryManager();
    renderAll();
    showToast("已删除分类");
  }

  function syncSettingsForm() {
    $("cycleStartDayInput").value = String(state.cycleStartDay);
    $("initialBalanceInput").value = centsToInput(state.initialBalanceCents);
    renderCategoryManager();
  }

  function openSettings() {
    syncSettingsForm();
    $("settingsOverlay").hidden = false;
    setModalLock(true);
  }

  function closeSettings() {
    $("settingsOverlay").hidden = true;
    setModalLock(false);
  }

  function saveSettings(event) {
    event.preventDefault();
    const initialBalance = parseAmountInput(
      $("initialBalanceInput").value,
      true
    );
    if (initialBalance === null) {
      showToast("请输入正确的初始余额");
      return;
    }
    state.initialBalanceCents = initialBalance;
    state.cycleStartDay = Number($("cycleStartDayInput").value);
    selectedCycleStartKey = currentCycleStartKey();
    persistState();
    renderAll();
    closeSettings();
    showToast("设置已保存");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "生活费账本-" + CORE.dateKeyToday() + ".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("已导出备份");
  }

  function importData(file) {
    if (!file) {
      return;
    }
    if (!window.confirm("导入会覆盖当前本地账本，确定继续吗？")) {
      $("importFile").value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        state = CORE.normalizeState(parsed);
        selectedCycleStartKey = currentCycleStartKey();
        persistState();
        renderAll();
        syncSettingsForm();
        showToast("已导入备份");
      } catch (error) {
        showToast("导入失败，文件格式不正确");
      } finally {
        $("importFile").value = "";
      }
    };
    reader.onerror = () => {
      showToast("读取文件失败");
      $("importFile").value = "";
    };
    reader.readAsText(file);
  }

  function openOnboarding() {
    $("onboardBalanceInput").value = "";
    $("onboardCycleDayInput").value = String(state.cycleStartDay || 1);
    $("onboardingOverlay").hidden = false;
    setModalLock(true);
    $("onboardBalanceInput").focus();
  }

  function saveOnboarding(event) {
    event.preventDefault();
    const initialBalance = parseAmountInput(
      $("onboardBalanceInput").value,
      true
    );
    if (initialBalance === null) {
      showToast("请输入正确的金额");
      return;
    }
    state.initialBalanceCents = initialBalance;
    state.cycleStartDay = Number($("onboardCycleDayInput").value);
    state.onboarded = true;
    selectedCycleStartKey = currentCycleStartKey();
    persistState();
    $("onboardingOverlay").hidden = true;
    setModalLock(false);
    renderAll();
  }

  function bindEvents() {
    $("openEntryBtn").addEventListener("click", openEntryModal);
    $("closeEntryBtn").addEventListener("click", closeEntryModal);
    $("cancelEntryBtn").addEventListener("click", closeEntryModal);
    $("entryForm").addEventListener("submit", saveEntry);
    $("amountInput").addEventListener("input", updateSaveButtonState);
    $("deleteEntryBtn").addEventListener("click", deleteEditingRecord);

    $("entryOverlay").addEventListener("click", (event) => {
      if (event.target === $("entryOverlay")) {
        closeEntryModal();
      }
    });

    $$("#entryTypeSwitch button").forEach((button) => {
      button.addEventListener("click", () => {
        entryType = button.dataset.type;
        setTypeButtons(entryType);
        setCategoryFieldVisible();
        if (entryType === "expense" && !selectedCategoryId) {
          selectedCategoryId = lastUsedCategoryId();
        }
        renderCategoryPicker(selectedCategoryId);
        updateSaveButtonState();
      });
    });

    $("categoryPicker").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-category-id]");
      if (!button) {
        return;
      }
      selectedCategoryId = button.dataset.categoryId;
      renderCategoryPicker(selectedCategoryId);
      updateSaveButtonState();
    });

    $("transactionList").addEventListener("click", (event) => {
      const row = event.target.closest("button[data-record-id]");
      if (row) {
        openEditModal(row.dataset.recordId);
      }
    });

    $("prevCycleBtn").addEventListener("click", () => {
      selectedCycleStartKey = CORE.shiftCycle(selectedCycleStartKey, -1);
      renderAll();
    });
    $("nextCycleBtn").addEventListener("click", () => {
      selectedCycleStartKey = CORE.shiftCycle(selectedCycleStartKey, 1);
      renderAll();
    });

    $("openSettingsBtn").addEventListener("click", openSettings);
    $("closeSettingsBtn").addEventListener("click", closeSettings);
    $$("[data-close-settings]").forEach((button) => {
      button.addEventListener("click", closeSettings);
    });
    $("settingsForm").addEventListener("submit", saveSettings);
    $("settingsOverlay").addEventListener("click", (event) => {
      if (event.target === $("settingsOverlay")) {
        closeSettings();
      }
    });

    $("addCategoryBtn").addEventListener("click", addCategory);
    $("newCategoryInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addCategory();
      }
    });
    $("categoryManager").addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-category]");
      if (button) {
        removeCategory(button.dataset.removeCategory);
      }
    });

    $("exportBtn").addEventListener("click", exportData);
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (event) => {
      importData(event.target.files && event.target.files[0]);
    });

    $("onboardingForm").addEventListener("submit", saveOnboarding);
  }

  function init() {
    hydrateIcons(document);
    populateCycleSelects();
    bindEvents();

    const loaded = readState();
    if (loaded && loaded.onboarded) {
      state = loaded;
      selectedCycleStartKey = currentCycleStartKey();
      renderAll();
    } else {
      state = CORE.createInitialState({ cycleStartDay: 1 });
      selectedCycleStartKey = currentCycleStartKey();
      renderAll();
      openOnboarding();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
