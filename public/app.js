const card = document.querySelector(".quota-card");
const bars = document.querySelector("#bars");
const statusText = document.querySelector("#statusText");
const updatedAt = document.querySelector("#updatedAt");
const avatar = document.querySelector("#avatar");
const displayName = document.querySelector("#displayName");
const planBadge = document.querySelector("#planBadge");
const liquidTurbulence = document.querySelector("#liquidTurbulence");
const liquidDisplacement = document.querySelector("#liquidDisplacement");

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

let lastValues = new Map();
const refreshAnimationMs = 1650;
const backgroundFlowMs = 2800;
let backgroundFlowTimer = null;
let backgroundFlowFrame = null;

loadQuota();
setInterval(loadQuota, 60_000);

async function loadQuota() {
  const startedAt = performance.now();
  restartRefreshAnimation();
  statusText.textContent = "正在刷新";
  statusText.classList.remove("error");

  try {
    const response = await fetch("/api/quota", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.quotas) {
      throw new Error(data.error || "读取失败");
    }

    render(data);
  } catch (error) {
    statusText.textContent = error.message || "读取失败";
    statusText.classList.add("error");
  } finally {
    const elapsed = performance.now() - startedAt;
    if (elapsed < refreshAnimationMs) {
      await wait(refreshAnimationMs - elapsed);
    }
    card.classList.remove("refreshing");
  }
}

function restartRefreshAnimation() {
  card.classList.remove("refreshing");
  restartBackgroundFlow();
  void card.offsetWidth;
  card.classList.add("refreshing");
}

function restartBackgroundFlow() {
  document.body.classList.remove("flowing");
  if (backgroundFlowTimer) {
    clearTimeout(backgroundFlowTimer);
  }
  if (backgroundFlowFrame) {
    cancelAnimationFrame(backgroundFlowFrame);
  }

  void document.body.offsetWidth;
  document.body.classList.add("flowing");
  animateLiquidFilter();
  backgroundFlowTimer = setTimeout(() => {
    document.body.classList.remove("flowing");
    resetLiquidFilter();
    backgroundFlowTimer = null;
  }, backgroundFlowMs);
}

function animateLiquidFilter() {
  const startedAt = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - startedAt) / backgroundFlowMs);
    const wave = Math.sin(progress * Math.PI);
    const wobble = Math.sin(progress * Math.PI * 4);
    const frequencyX = 0.009 + wave * 0.008 + wobble * 0.0015;
    const frequencyY = 0.018 + wave * 0.012 - wobble * 0.002;
    const displacement = 1 + wave * 34;

    liquidTurbulence?.setAttribute("baseFrequency", `${frequencyX.toFixed(4)} ${frequencyY.toFixed(4)}`);
    liquidDisplacement?.setAttribute("scale", displacement.toFixed(1));

    if (progress < 1) {
      backgroundFlowFrame = requestAnimationFrame(tick);
    } else {
      resetLiquidFilter();
      backgroundFlowFrame = null;
    }
  }

  backgroundFlowFrame = requestAnimationFrame(tick);
}

function resetLiquidFilter() {
  liquidTurbulence?.setAttribute("baseFrequency", "0.009 0.018");
  liquidDisplacement?.setAttribute("scale", "0");
}

function render(data) {
  const name = data.displayName || data.username || "Codex";
  displayName.textContent = name;
  planBadge.textContent = data.planName || "--";
  renderAvatar(name, data.avatarURL);

  bars.replaceChildren(...data.quotas.map((quota) => quotaRow(quota)));
  statusText.textContent = data.stale ? "读取失败，显示缓存" : data.cached ? "已从缓存更新" : "已刷新";
  statusText.classList.toggle("error", Boolean(data.stale));
  updatedAt.textContent = data.updatedAt ? `更新于 ${formatter.format(new Date(data.updatedAt))}` : "";

  requestAnimationFrame(() => {
    for (const quota of data.quotas) {
      const fill = document.querySelector(`[data-fill="${quota.id}"]`);
      if (fill) fill.style.width = `${quota.remainingPercent}%`;
      animateNumber(quota.id, quota.remainingPercent);
    }
  });
}

function renderAvatar(name, avatarURL) {
  avatar.textContent = initial(name);
  avatar.style.backgroundImage = "";
  avatar.classList.remove("has-image");

  if (!avatarURL) return;

  const image = new Image();
  image.onload = () => {
    avatar.textContent = "";
    avatar.style.backgroundImage = `url("${avatarURL}")`;
    avatar.classList.add("has-image");
  };
  image.src = avatarURL;
}

function quotaRow(quota) {
  const row = document.createElement("article");
  row.className = "quota-row";

  row.innerHTML = `
    <div class="row-top">
      <span>${escapeHtml(quota.title)}</span>
      <strong data-value="${escapeHtml(quota.id)}">0%</strong>
    </div>
    <div class="progress-track">
      <div class="progress-fill" data-fill="${escapeHtml(quota.id)}"></div>
    </div>
    <p>${resetText(quota.resetAt)}</p>
  `;

  return row;
}

function resetText(resetAt) {
  if (!resetAt) return "暂未返回重置时间";
  return `${formatter.format(new Date(resetAt))} 重置`;
}

function animateNumber(id, target) {
  const el = document.querySelector(`[data-value="${id}"]`);
  if (!el) return;

  const targetValue = Math.round(target);
  const start = lastValues.get(id) ?? 0;
  const duration = 720;
  const startedAt = performance.now();

  function tick(now) {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(start + (targetValue - start) * eased);
    el.textContent = `${value}%`;

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      lastValues.set(id, targetValue);
      el.textContent = `${targetValue}%`;
    }
  }

  requestAnimationFrame(tick);
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
