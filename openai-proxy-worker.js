// Cloudflare Worker — OpenAI CORS Proxy (API Key 내장)
// API Key는 Cloudflare Worker 환경변수 OPENAI_API_KEY에 Secret으로 저장
// 플러그인에서는 Authorization 헤더 없이 요청, Worker가 키를 주입

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      return corsJson({ error: { message: "Server API key not configured" } }, 500);
    }

    try {
      const body = await request.text();
      const response = await fetch("https://us.api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey,
        },
        body,
      });

      const data = await response.text();
      return new Response(data, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      return corsJson({ error: { message: err.message } }, 500);
    }
  },
};

function corsJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
