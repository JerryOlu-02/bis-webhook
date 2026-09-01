const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.nctrhq.com", // or your custom domain
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/subscribe" && request.method === "POST") {
      const {
        email,
        variantId,
        productId,
        productTitle,
        imageUrl,
        productHandle,
      } = await request.json();

      if (!email || !variantId) {
        return new Response(JSON.stringify({ error: "Missing fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const key = `variant:${variantId}`;
      const existing = (await env.SUBSCRIBERS.get(key, { type: "json" })) || [];

      if (!existing.some((s) => s.email === email)) {
        existing.push({
          email,
          productId,
          productTitle,
          imageUrl,
          productHandle,
        });
        await env.SUBSCRIBERS.put(key, JSON.stringify(existing));
      }

      const klaviyoKey = await env.KLAVIYO_PRIVATE_KEY.get();

      // Fire your reporting event server-side (bypasses all the ad-blocker/consent issues from earlier)
      await fetch("https://a.klaviyo.com/api/events", {
        method: "POST",
        headers: {
          Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
          "Content-Type": "application/json",
          revision: "2024-10-15",
        },
        body: JSON.stringify({
          data: {
            type: "event",
            attributes: {
              properties: {
                VariantID: variantId,
                ProductID: productId,
                ProductTitle: productTitle,
              },
              metric: {
                data: {
                  type: "metric",
                  attributes: { name: "Requested Back In Stock" },
                },
              },
              profile: { data: { type: "profile", attributes: { email } } },
            },
          },
        }),
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (url.pathname === "/restock" && request.method === "POST") {
      const { variantId, inventoryQuantity } = await request.json();

      if (inventoryQuantity <= 0) {
        return new Response(JSON.stringify({ skipped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }

      const klaviyoKey = await env.KLAVIYO_PRIVATE_KEY.get();

      const key = `variant:${variantId}`;
      const subscribers =
        (await env.SUBSCRIBERS.get(key, { type: "json" })) || [];

      for (const sub of subscribers) {
        await fetch("https://a.klaviyo.com/api/events", {
          method: "POST",
          headers: {
            Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
            "Content-Type": "application/json",
            revision: "2024-10-15",
          },
          body: JSON.stringify({
            data: {
              type: "event",
              attributes: {
                properties: {
                  VariantID: variantId,
                  ProductID: sub.productId,
                  ProductTitle: sub.productTitle,
                  ImageUrl: sub.imageUrl,
                  ProductHandle: sub.productHandle,
                },
                metric: {
                  data: {
                    type: "metric",
                    attributes: { name: "Restock Notification Ready" },
                  },
                },
                profile: {
                  data: { type: "profile", attributes: { email: sub.email } },
                },
              },
            },
          }),
        });
      }

      await env.SUBSCRIBERS.delete(key); // clear so they don't get notified again next restock unless they re-subscribe

      return new Response(JSON.stringify({ notified: subscribers.length }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};
