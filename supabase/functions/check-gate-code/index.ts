import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GATE_ACCESS_CODE = Deno.env.get("GATE_ACCESS_CODE")!

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const code = String(body?.code ?? "").trim().toUpperCase()

    const ok = code.length > 0 && code === GATE_ACCESS_CODE

    return new Response(JSON.stringify({ ok }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })

  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    })
  }
})
