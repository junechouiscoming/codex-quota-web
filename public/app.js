const card = document.querySelector(".card-front");
const cardStage = document.querySelector(".card-stage");
const cardBack = document.querySelector(".card-back");
const bars = document.querySelector("#bars");
const updatedAt = document.querySelector("#updatedAt");
const profile = document.querySelector(".profile");
const avatar = document.querySelector("#avatar");
const displayName = document.querySelector("#displayName");
const planBadge = document.querySelector("#planBadge");
const quotaInscription = document.querySelector("#quotaInscription");
const inscriptionDetail = document.querySelector("#inscriptionDetail");
const inscriptionSeal = document.querySelector("#inscriptionSeal");

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const refreshIntervalMs = 30 * 60_000;
const relativeTimeMs = 10 * 60_000;
const progressAnimationMs = 1600;
let lastAvatarURL = null;
let numberAnimationFrames = new Map();
let fillAnimationTimers = new WeakMap();
let staticRendered = false;
const refreshAnimationMs = 1650;
const scanIntervalMs = 3000;
const scanAnimationMs = 1650;
let refreshAnimationToken = 0;
let refreshAnimationEndAt = 0;
let refreshInProgress = false;
let refreshQueued = false;
let scanTimer = null;
let scanEndTimer = null;
let autoFlipTimer = null;
let flipLockTimer = null;
let resetCountdownTimers = new WeakMap();

loadQuota();
setInterval(loadQuota, refreshIntervalMs);

document.addEventListener("pointermove", handlePointerMove);
document.addEventListener("pointerleave", resetCardTilt);
document.addEventListener("click", handleDocumentClick, true);
planBadge.addEventListener("click", showCardBack);
cardBack.addEventListener("click", showQuotaFront);
cardBack.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    showQuotaFront();
  }
});
bars.addEventListener("click", (event) => {
  const track = event.target.closest(".progress-track");
  if (!track) return;
  showResetCountdown(track.closest(".quota-row"));
});
bars.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const track = event.target.closest(".progress-track");
  if (!track) return;

  event.preventDefault();
  showResetCountdown(track.closest(".quota-row"));
});

async function loadQuota() {
  if (refreshInProgress) {
    refreshQueued = true;
    return;
  }

  refreshInProgress = true;
  try {
    do {
      refreshQueued = false;
      await runQuotaRefresh();
    } while (refreshQueued);
  } finally {
    refreshInProgress = false;
  }
}

async function runQuotaRefresh() {
  const animationToken = restartRefreshAnimation();

  try {
    const response = await fetch("/api/quota", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.quotas) {
      throw new Error(data.error || "读取失败");
    }

    render(data, { animate: true });
  } catch (error) {
    console.warn(error.message || "读取失败");
  } finally {
    const animationEndAt = refreshAnimationEndAt;
    const remaining = animationEndAt - performance.now();
    if (remaining > 0) {
      await wait(remaining);
    }

    if (animationToken !== null) {
      if (animationToken === refreshAnimationToken) {
        card.classList.remove("refreshing");
        cardStage.classList.add("floating");
        if (!isCardFlipped()) {
          scheduleShowcaseScan();
        }
      }
    }
  }
}

function restartRefreshAnimation() {
  const now = performance.now();
  // Let an in-flight scan finish instead of jittering from repeated short refreshes.
  if (card.classList.contains("refreshing") && now < refreshAnimationEndAt) {
    return null;
  }

  stopShowcaseScan();
  refreshAnimationEndAt = now + refreshAnimationMs;
  refreshAnimationToken += 1;
  card.classList.remove("refreshing");
  cardStage.classList.remove("floating");
  void card.offsetWidth;
  card.classList.add("refreshing");
  return refreshAnimationToken;
}

function scheduleShowcaseScan() {
  if (isCardFlipped()) return;

  clearScanTimers();
  scanTimer = setTimeout(runShowcaseScan, scanIntervalMs);
}

function runShowcaseScan() {
  scanTimer = null;
  if (refreshInProgress || card.classList.contains("refreshing") || isCardFlipped()) {
    scheduleShowcaseScan();
    return;
  }

  card.classList.remove("scanning");
  card.classList.remove("badge-flowing");
  void card.offsetWidth;
  card.classList.add("scanning");

  scanEndTimer = setTimeout(() => {
    card.classList.remove("scanning");
    card.classList.add("badge-flowing");
    scanEndTimer = null;
    scheduleShowcaseScan();
  }, scanAnimationMs);
}

function stopShowcaseScan() {
  clearScanTimers();
  card.classList.remove("scanning");
  card.classList.remove("badge-flowing");
}

function clearScanTimers() {
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  if (scanEndTimer) {
    clearTimeout(scanEndTimer);
    scanEndTimer = null;
  }
}

function showCardBack() {
  stopShowcaseScan();
  clearAutoFlipTimer();
  startFlipLock();
  cardStage.classList.remove("badge-hovering");
  planBadge.classList.remove("badge-active");
  cardStage.classList.add("flipped");
  card.setAttribute("aria-hidden", "true");
  cardBack.setAttribute("aria-hidden", "false");
  cardBack.setAttribute("tabindex", "0");
  cardBack.focus({ preventScroll: true });
  autoFlipTimer = setTimeout(showQuotaFront, 5000);
}

function showQuotaFront() {
  clearAutoFlipTimer();
  startFlipLock();
  cardStage.classList.remove("flipped");
  card.setAttribute("aria-hidden", "false");
  cardBack.setAttribute("aria-hidden", "true");
  cardBack.setAttribute("tabindex", "-1");
  planBadge.focus({ preventScroll: true });
  if (!refreshInProgress && !card.classList.contains("refreshing")) {
    scheduleShowcaseScan();
  }
}

function clearAutoFlipTimer() {
  if (autoFlipTimer) {
    clearTimeout(autoFlipTimer);
    autoFlipTimer = null;
  }
}

function startFlipLock() {
  if (flipLockTimer) {
    clearTimeout(flipLockTimer);
  }

  cardStage.classList.remove("tilting");
  cardStage.classList.add("flipping");
  flipLockTimer = setTimeout(() => {
    cardStage.classList.remove("flipping");
    flipLockTimer = null;
  }, 1250);
}

function handleDocumentClick(event) {
  if (!isCardFlipped()) {
    const progressRow = progressRowFromPoint(event);
    if (progressRow) {
      event.preventDefault();
      event.stopPropagation();
      showResetCountdown(progressRow);
      return;
    }
  }

  if (!isCardFlipped() && isPointInRect(event, planBadge.getBoundingClientRect())) {
    event.preventDefault();
    event.stopPropagation();
    showCardBack();
    return;
  }

  if (isCardFlipped() && isPointInRect(event, cardBack.getBoundingClientRect())) {
    event.preventDefault();
    event.stopPropagation();
    showQuotaFront();
  }
}

function handlePointerMove(event) {
  const stageRect = cardStage.getBoundingClientRect();
  const insideStage = isPointInRect(event, stageRect);
  if (insideStage && !cardStage.classList.contains("flipping")) {
    updateCardTilt(event, stageRect);
  } else if (!insideStage) {
    resetCardTilt();
  }

  if (!profile) return;

  const avatarRect = avatar.getBoundingClientRect();
  profile.classList.toggle("profile-active", isPointInRect(event, avatarRect));

  const badgeActive = !isCardFlipped() && isPointInRect(event, planBadge.getBoundingClientRect());
  planBadge.classList.toggle("badge-active", badgeActive);
  cardStage.classList.toggle("badge-hovering", badgeActive);
}

function updateCardTilt(event, rect = cardStage.getBoundingClientRect()) {
  if (!rect.width || !rect.height) return;

  const x = ((event.clientX - rect.left) / rect.width - 0.5) * 100;
  const y = ((event.clientY - rect.top) / rect.height - 0.5) * 100;
  cardStage.classList.add("tilting");
  cardStage.style.setProperty("--card-tilt-x", `${(-y * 0.045).toFixed(2)}deg`);
  cardStage.style.setProperty("--card-tilt-y", `${(x * 0.055).toFixed(2)}deg`);
  cardStage.style.setProperty("--foil-light-x", `${(50 + x * 0.32).toFixed(1)}%`);
  cardStage.style.setProperty("--foil-light-y", `${(48 + y * 0.32).toFixed(1)}%`);
  cardStage.style.setProperty("--foil-shift-x", `${(x * 0.05).toFixed(2)}px`);
  cardStage.style.setProperty("--foil-shift-y", `${(y * 0.05).toFixed(2)}px`);
}

function resetCardTilt() {
  cardStage.classList.remove("tilting");
  cardStage.style.setProperty("--card-tilt-x", "0deg");
  cardStage.style.setProperty("--card-tilt-y", "0deg");
  cardStage.style.setProperty("--foil-light-x", "50%");
  cardStage.style.setProperty("--foil-light-y", "48%");
  cardStage.style.setProperty("--foil-shift-x", "0px");
  cardStage.style.setProperty("--foil-shift-y", "0px");
  profile?.classList.remove("profile-active");
  planBadge.classList.remove("badge-active");
  cardStage.classList.remove("badge-hovering");
}

function isPointInRect(event, rect) {
  return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
}

function progressRowFromPoint(event) {
  for (const track of bars.querySelectorAll(".progress-track")) {
    if (isPointInRect(event, track.getBoundingClientRect())) {
      return track.closest(".quota-row");
    }
  }
  return null;
}

function isCardFlipped() {
  return cardStage.classList.contains("flipped");
}

function render(data, { animate = true } = {}) {
  if (!staticRendered) {
    renderStatic(data);
  }

  renderProgress(data, { animate });
  renderBackPanel(data);
  renderUpdatedAt(data.updatedAt);
}

function renderStatic(data) {
  const name = data.displayName || data.username || "Codex";
  displayName.textContent = name;
  planBadge.textContent = data.planName || "--";
  renderAvatar(name, data.avatarURL);

  renderQuotaRows(data.quotas);
  staticRendered = true;
}

function renderBackPanel(data) {
  const name = data.displayName || data.username || "Codex";
  const inscription = inscriptionText(data.quotas);
  quotaInscription.textContent = inscription;
  quotaInscription.dataset.text = inscription;
  inscriptionDetail.textContent = `持卡人 ${name} · ${data.planName || "--"}`;
  inscriptionSeal.textContent = `${cycleText(data.quotas)} · QUOTA SEAL`;
}

function renderProgress(data, { animate }) {
  requestAnimationFrame(() => {
    for (const quota of data.quotas) {
      const fill = document.querySelector(`[data-fill="${quota.id}"]`);
      if (animate) {
        animateFill(fill, quota.remainingPercent);
        animateNumber(quota.id, quota.remainingPercent);
      } else {
        setFill(fill, quota.remainingPercent);
        setNumber(quota.id, quota.remainingPercent);
      }
    }
  });
}

function renderAvatar(name, avatarURL) {
  if (avatarURL === lastAvatarURL && (avatarURL || avatar.textContent === initial(name))) {
    return;
  }

  if (!avatarURL) {
    lastAvatarURL = null;
    avatar.textContent = initial(name);
    avatar.style.backgroundImage = "";
    avatar.classList.remove("has-image");
    return;
  }

  const image = new Image();
  image.onload = () => {
    lastAvatarURL = avatarURL;
    avatar.textContent = "";
    avatar.style.backgroundImage = `url("${avatarURL}")`;
    avatar.classList.add("has-image");
  };
  image.src = avatarURL;
}

function renderQuotaRows(quotas) {
  const nextIds = new Set(quotas.map((quota) => quota.id));

  for (const row of bars.querySelectorAll(".quota-row:not([data-quota-row])")) {
    row.remove();
  }

  for (const row of bars.querySelectorAll("[data-quota-row]")) {
    if (!nextIds.has(row.dataset.quotaRow)) {
      row.remove();
    }
  }

  for (const quota of quotas) {
    let row = bars.querySelector(`[data-quota-row="${cssEscape(quota.id)}"]`);
    if (!row) {
      row = quotaRow(quota);
      bars.append(row);
    } else if (row.classList.contains("loading")) {
      row.querySelector("[data-title]").textContent = quota.title;
    }

    const resetEl = row.querySelector("[data-reset]");
    clearResetCountdownTimer(row);
    resetEl.classList.remove("countdown-active");
    row.dataset.resetAt = quota.resetAt || "";
    resetEl.textContent = resetText(quota.resetAt);
    enhanceProgressTrack(row, quota);
    row.classList.remove("loading");
  }
}

function quotaRow(quota) {
  const row = document.createElement("article");
  row.className = "quota-row";
  row.dataset.quotaRow = quota.id;

  row.innerHTML = `
    <div class="row-top">
      <span data-title>${escapeHtml(quota.title)}</span>
      <strong data-value="${escapeHtml(quota.id)}">0%</strong>
    </div>
    <div class="progress-track" role="button" tabindex="0" aria-label="显示${escapeHtml(quota.title)}重置倒计时">
      <div class="progress-fill" data-fill="${escapeHtml(quota.id)}"></div>
    </div>
    <p data-reset>${resetText(quota.resetAt)}</p>
  `;

  return row;
}

function enhanceProgressTrack(row, quota) {
  const track = row.querySelector(".progress-track");
  if (!track) return;

  track.setAttribute("role", "button");
  track.setAttribute("tabindex", "0");
  track.setAttribute("aria-label", `显示${quota.title}重置倒计时`);
}

function resetText(resetAt) {
  if (!resetAt) return "暂未返回重置时间";
  return `${formatter.format(new Date(resetAt))} 重置`;
}

function showResetCountdown(row) {
  if (!row) return;

  const resetEl = row.querySelector("[data-reset]");
  const resetAt = row.dataset.resetAt;
  if (!resetEl || !resetAt) return;

  clearResetCountdownTimer(row);
  resetEl.textContent = countdownText(resetAt);
  resetEl.classList.add("countdown-active");

  const timer = setTimeout(() => {
    resetEl.textContent = resetText(resetAt);
    resetEl.classList.remove("countdown-active");
    resetCountdownTimers.delete(row);
  }, 5000);
  resetCountdownTimers.set(row, timer);
}

function clearResetCountdownTimer(row) {
  const timer = resetCountdownTimers.get(row);
  if (timer) {
    clearTimeout(timer);
    resetCountdownTimers.delete(row);
  }
}

function countdownText(resetAt) {
  const remaining = new Date(resetAt).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return "即将重置";
  }

  const totalMinutes = Math.ceil(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `重置倒计时 ${days}天${hours}小时`;
  if (hours > 0) return `重置倒计时 ${hours}小时${minutes}分`;
  return `重置倒计时 ${minutes}分`;
}

function renderUpdatedAt(value) {
  updatedAt.textContent = formatUpdatedAt(value);
}

function formatUpdatedAt(value) {
  if (!value) return "";

  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < relativeTimeMs) {
    const minutes = Math.floor(elapsed / 60_000);
    return minutes <= 0 ? "更新于 刚刚" : `更新于 ${minutes}分钟前`;
  }

  return `更新于 ${formatter.format(date)}`;
}

function cycleText(quotas) {
  const titles = quotas.map((quota) => quota.title || quota.id || "");
  const hasHourly = titles.some((title) => title.includes("5") || title.toLowerCase().includes("hour"));
  const hasWeekly = titles.some((title) => title.includes("周") || title.toLowerCase().includes("week"));

  if (hasHourly && hasWeekly) return "5H / WEEKLY";
  if (hasWeekly) return "WEEKLY";
  if (hasHourly) return "5H";
  return "ACTIVE";
}

function inscriptionText(quotas) {
  const percents = quotas
    .map((quota) => Number(quota.remainingPercent))
    .filter((value) => Number.isFinite(value));
  const reserve = percents.length ? Math.min(...percents) : 0;

  if (reserve >= 75) return "今日算力充盈，宜开锋试炼。";
  if (reserve >= 50) return "今日额度尚丰，可从容落子。";
  if (reserve >= 25) return "今日余量有度，宜精修慎取。";
  if (reserve > 0) return "今日算力将尽，宜藏锋待时。";
  return "今日额度暂歇，宜养神候潮。";
}

function animateNumber(id, target) {
  const el = document.querySelector(`[data-value="${id}"]`);
  if (!el) return;

  if (numberAnimationFrames.has(id)) {
    cancelAnimationFrame(numberAnimationFrames.get(id));
  }

  const targetValue = Math.round(target);
  const start = 0;
  const duration = progressAnimationMs;
  const startedAt = performance.now();
  el.textContent = `${start}%`;

  function tick(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(start + (targetValue - start) * eased);
    el.textContent = `${value}%`;

    if (progress < 1) {
      numberAnimationFrames.set(id, requestAnimationFrame(tick));
    } else {
      numberAnimationFrames.delete(id);
      el.textContent = `${targetValue}%`;
    }
  }

  numberAnimationFrames.set(id, requestAnimationFrame(tick));
}

function setNumber(id, target) {
  const el = document.querySelector(`[data-value="${id}"]`);
  if (!el) return;

  if (numberAnimationFrames.has(id)) {
    cancelAnimationFrame(numberAnimationFrames.get(id));
    numberAnimationFrames.delete(id);
  }

  const value = Math.round(target);
  el.textContent = `${value}%`;
}

function animateFill(fill, target) {
  if (!fill) return;

  clearFillAnimationTimer(fill);
  fill.classList.remove("recalculating");
  fill.style.transition = "none";
  fill.style.width = "0%";
  void fill.offsetWidth;
  fill.style.transition = "";
  fill.classList.add("recalculating");
  requestAnimationFrame(() => {
    fill.style.width = `${target}%`;
  });

  const timer = setTimeout(() => {
    fill.classList.remove("recalculating");
    fillAnimationTimers.delete(fill);
  }, progressAnimationMs);
  fillAnimationTimers.set(fill, timer);
}

function setFill(fill, target) {
  if (!fill) return;

  clearFillAnimationTimer(fill);
  fill.classList.remove("recalculating");
  fill.style.width = `${target}%`;
}

function clearFillAnimationTimer(fill) {
  const timer = fillAnimationTimers.get(fill);
  if (timer) {
    clearTimeout(timer);
    fillAnimationTimers.delete(fill);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initial(value) {
  return String(value || "C").trim().slice(0, 1).toUpperCase();
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value));
  return String(value).replaceAll('"', '\\"');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
