/** Netlify Function：拍照识蛋白 → DashScope / Token Plan */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Netlify 同步 Function 默认 10s 上限（Pro 可申请提到 26s）。
// 总预算必须小于平台上限，否则平台先杀进程，用户看到的是不透明错误。
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 9000);
const TOTAL_BUDGET_MS = Number(process.env.TOTAL_BUDGET_MS || 9500);
const CHINA_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const INTL_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const TOKEN_PLAN_BASES = [
  "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
];

function json(status, obj) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

function normalizeKey(key) {
  return String(key || "")
    .trim()
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "");
}

/** @returns {string|false} */
function validateKey(key) {
  const k = normalizeKey(key);
  if (!k || k.length < 16 || k.length > 256) return false;
  if (!/^sk-[^\s]+$/i.test(k)) return false;
  return k;
}

function isTokenPlanKey(apiKey) {
  return /^sk-sp-/i.test(apiKey);
}

function basesForKey(apiKey) {
  if (isTokenPlanKey(apiKey)) return TOKEN_PLAN_BASES.slice();
  const env = (process.env.DASHSCOPE_BASE_URL || "").replace(/\/$/, "");
  if (env) return [env];
  return [CHINA_BASE, INTL_BASE];
}

function photoModelsForKey(apiKey) {
  if (isTokenPlanKey(apiKey)) return ["qwen3.6-flash", "qwen3.7-plus"];
  return ["qwen-vl-max", "qwen3-vl-plus"];
}

function shouldRetryIntl(status, text) {
  if (status !== 401) return false;
  try {
    const j = JSON.parse(text);
    const code = j && j.error && j.error.code;
    const msg = (j && j.error && j.error.message) || "";
    return (
      code === "invalid_api_key" ||
      /incorrect api key|invalid api key|apikey-error/i.test(msg)
    );
  } catch {
    return false;
  }
}

function shouldRetryModel(status, text) {
  if (status !== 400 && status !== 403 && status !== 404) return false;
  try {
    const blob = JSON.stringify(JSON.parse(text)).toLowerCase();
    return /model|does not exist|not exist|not found|access denied|permission/.test(
      blob
    );
  } catch {
    return false;
  }
}

async function postOnce(base, payload, apiKey, budgetMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(UPSTREAM_TIMEOUT_MS, budgetMs)
  );
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      text,
      ctype: res.headers.get("content-type") || "application/json; charset=utf-8",
    };
  } catch (e) {
    if (e && e.name === "AbortError") {
      return { err: json(504, { error: { message: "upstream timeout" } }) };
    }
    return { err: json(502, { error: { message: "upstream unreachable" } }) };
  } finally {
    clearTimeout(timer);
  }
}

async function forwardUpstream(payload, apiKey) {
  const bases = basesForKey(apiKey);
  const models = photoModelsForKey(apiKey);
  let last = null;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const model of models) {
    const body = { ...payload, model, stream: false };
    for (let i = 0; i < bases.length; i++) {
      const budgetMs = deadline - Date.now();
      if (budgetMs <= 500) {
        if (last) return { status: last.status, text: last.text, ctype: last.ctype };
        return { err: json(504, { error: { message: "upstream timeout" } }) };
      }
      const out = await postOnce(bases[i], body, apiKey, budgetMs);
      if (out.err) return out;
      if (out.ok) {
        return { status: out.status, text: out.text, ctype: out.ctype };
      }
      last = out;
      if (shouldRetryIntl(out.status, out.text) && i < bases.length - 1) {
        continue;
      }
      if (shouldRetryModel(out.status, out.text)) {
        break;
      }
      return {
        status: out.status,
        text: out.text,
        ctype: out.ctype,
      };
    }
  }

  if (last) {
    return { status: last.status, text: last.text, ctype: last.ctype };
  }
  return { err: json(502, { error: { message: "upstream unreachable" } }) };
}

function readBody(event) {
  const raw = event.body || "";
  const body = event.isBase64Encoded ? Buffer.from(raw, "base64") : Buffer.from(raw, "utf8");
  const clHeader = event.headers["content-length"] || event.headers["Content-Length"];
  let cl = clHeader != null && clHeader !== "" ? parseInt(clHeader, 10) : NaN;
  if (!Number.isFinite(cl)) cl = body.length;
  if (cl <= 0) return { err: json(400, { error: { message: "empty body" } }) };
  if (cl > MAX_BODY_BYTES) return { err: json(413, { error: { message: "request body too large" } }) };
  if (body.length !== cl) return { err: json(400, { error: { message: "incomplete body" } }) };
  return { body };
}

// ---- Origin 校验 ----
function checkOrigin(headers) {
  const source = headers["origin"] || headers["Origin"] || headers["referer"] || headers["Referer"] || "";
  if (!source) return false;
  try {
    const host = new URL(source).hostname;
    if (!host) return false;
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") return true;
    return host.endsWith(".netlify.app");
  } catch {
    return false;
  }
}

// ---- IP 限流（内存滑窗，进程级；Netlify 冷启动会重置，够用） ----
const _rateBuckets = new Map();
const RATE_LIMIT_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(clientIp) {
  const now = Date.now();
  let bucket = _rateBuckets.get(clientIp);
  if (!bucket) {
    bucket = [];
    _rateBuckets.set(clientIp, bucket);
  }
  const cutoff = now - RATE_WINDOW_MS;
  while (bucket.length && bucket[0] < cutoff) bucket.shift();
  if (bucket.length >= RATE_LIMIT_PER_MINUTE) return false;
  bucket.push(now);
  return true;
}

exports.handler = async (event) => {
  if ((event.httpMethod || "").toUpperCase() !== "POST") {
    return json(405, { error: { message: "use POST" } });
  }

  // Origin 校验
  if (!checkOrigin(event.headers || {})) {
    return json(403, { error: { message: "forbidden origin" } });
  }

  // IP 限流
  const clientIp =
    (event.headers["x-forwarded-for"] || event.headers["X-Forwarded-For"] || "").split(",")[0].trim() ||
    event.headers["client-ip"] ||
    "unknown";
  if (!checkRateLimit(clientIp)) {
    return json(429, { error: { message: "rate limit exceeded" } });
  }

  const rawKey =
    event.headers["x-dashscope-key"] || event.headers["X-DashScope-Key"] || "";
  const apiKey = validateKey(rawKey);
  if (!apiKey) {
    return json(401, {
      error: {
        message: "missing or invalid X-DashScope-Key",
        code: "relay_key_format",
      },
    });
  }

  const parsed = readBody(event);
  if (parsed.err) return parsed.err;

  let payload;
  try {
    payload = JSON.parse(parsed.body.toString("utf8"));
  } catch {
    return json(400, { error: { message: "invalid JSON body" } });
  }
  if (!payload || typeof payload !== "object") {
    return json(400, { error: { message: "body must be a JSON object" } });
  }
  if (!payload.messages) {
    return json(400, { error: { message: "missing messages" } });
  }

  const out = await forwardUpstream(payload, apiKey);
  if (out.err) return out.err;
  return {
    statusCode: out.status,
    headers: { "Content-Type": out.ctype, "Cache-Control": "no-store" },
    body: out.text,
  };
};
