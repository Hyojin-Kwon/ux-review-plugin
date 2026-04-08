// Cloudflare Worker — OpenAI CORS Proxy
// 배포 방법:
// 1. https://dash.cloudflare.com → Workers & Pages → Create Worker
// 2. 아래 코드를 붙여넣고 Deploy
// 3. 배포된 URL (예: https://xxx.workers.dev)을 플러그인 설정에 입력

export default {
  async fetch(request) {
    // Preflight OPTIONS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // OpenAI API로 프록시
    const body = await request.text();
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
      return corsJson({ error: { message: "Authorization header required" } }, 401);
    }

    try {
      const response = await fetch("https://us.api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
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
