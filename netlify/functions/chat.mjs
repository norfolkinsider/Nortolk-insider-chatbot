// netlify/functions/chat.mjs

async function callClaude(apiKey, body, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.content) return data;
    }

    const errText = await res.text().catch(() => "unknown");
    console.error(`Anthropic attempt ${i + 1} failed:`, errText);

    if (i < retries) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return null;
}

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { messages } = await req.json();
    if (!messages?.length) return json(400, { error: "No messages" });

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
    if (!ANTHROPIC_KEY || !AIRTABLE_KEY) {
      return json(500, { error: "Server misconfigured" });
    }

    const BASE_ID = "appAtE1hE5frgdQFo";
    const TABLE_ID = "tblxnJEq6aeYI8BYM";
    const FIELDS = {
      blurb: "fldtGFKlOTpe1x7kF",
      title: "fldnPS0scCcnsxjsY",
      date: "fldSuwVwThSY8lqrR",
      location: "fldhCWmjmC74mBOT6",
      source: "fldhRbXh1A7hP9xDa",
      status: "fldxpNS00UMZGGDME",
      type: "fld8KpsPIGZsnE5vX",
      submitterName: "fldugVnM5Wt0pcIHz",
      link: "fld34PQ0o0q4eDfog",
    };

    const systemPrompt = `You are the Norfolk Insider front desk bot. Collect community tips from people in Norfolk County, Ontario.

Your job is to extract the facts — not rewrite them. Save exactly what the person tells you. Do not embellish, add details, or remove details. If they give you a sentence, save that sentence. If they give you bullet points, save those.

Collect:
- **Who**: person or organization involved
- **What**: the event, news, milestone
- **When**: date (convert to YYYY-MM-DD format, but keep their original wording in the blurb). Today is ${new Date().toISOString().split("T")[0]}.
- **Where**: location in Norfolk County — Simcoe, Port Dover, Delhi, Waterford, Port Rowan, or Norfolk County for county-wide items
- **Why**: any extra context they provide
- **Link**: any URL they share — preserve exactly as given, never drop it

For the blurb, save what the person actually said — their words, not yours. Do not rewrite, summarize, or polish. Just capture their info faithfully.

For the title, use a short factual label (e.g. "Felicia McMinn at Barrel", "Bob Smith 80th Birthday").

Classify the type as: Event, Birthday, Anniversary, Community News, Business Update, or Other.

If critical info is missing (what, when, or where), ask for it. Keep it brief and conversational — 1-2 sentences max. Don't interrogate. After saving, ask if they have anything else to share.`;

    const tools = [
      {
        name: "submit_tip",
        description:
          "Submit a community tip/submission to the Norfolk Insider database.",
        input_schema: {
          type: "object",
          required: ["title", "type", "blurb"],
          properties: {
            title: {
              type: "string",
              description: "Short title for the submission",
            },
            type: {
              type: "string",
              enum: [
                "Event",
                "Birthday",
                "Anniversary",
                "Community News",
                "Business Update",
                "Other",
              ],
              description: "Category of submission",
            },
            blurb: {
              type: "string",
              description: "The person's own words describing what they're sharing — do not rewrite or polish",
            },
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format (if applicable)",
            },
            location: {
              type: "string",
              enum: [
                "Simcoe",
                "Port Dover",
                "Delhi",
                "Waterford",
                "Port Rowan",
                "Norfolk County",
              ],
              description: "Town/city in Norfolk County",
            },
            submitter_name: {
              type: "string",
              description: "Name of the person submitting (if provided)",
            },
            link: {
              type: "string",
              description: "Any URL the user provided — event page, poster, Facebook event, ticket link, etc. Preserve exactly as given.",
            },
          },
        },
      },
    ];

    // First API call
    const data = await callClaude(ANTHROPIC_KEY, {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    if (!data) {
      return json(200, { reply: "I'm a little busy right now — could you try again in a moment?", tool_used: false });
    }
    const toolUse = data.content.find((b) => b.type === "tool_use");

    if (!toolUse) {
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return json(200, { reply: text, tool_used: false });
    }

    const { title, type, blurb, date, location, submitter_name, link } =
      toolUse.input;

    // Check duplicates: same title + same date (if date exists)
    let isDuplicate = false;
    if (date) {
      const filterFormula = `AND({Title}="${escapeSingleQuotes(title)}",{Date}="${date}")`;
      const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=1`;
      const dupeCheck = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
      });
      const dupeData = await dupeCheck.json();
      isDuplicate = dupeData.records?.length > 0;
    }

    let toolResultContent;

    if (isDuplicate) {
      toolResultContent = `DUPLICATE DETECTED: A submission titled "${title}" on ${date} already exists. Tell the user this has already been submitted and ask if they have something else to share.`;
    } else {
      const fields = {
        [FIELDS.blurb]: blurb,
        [FIELDS.title]: title,
        [FIELDS.type]: type,
        [FIELDS.source]: "Website Chatbot",
      };
      if (date) fields[FIELDS.date] = date;
      if (location) fields[FIELDS.location] = location;
      if (submitter_name) fields[FIELDS.submitterName] = submitter_name;
      if (link) fields[FIELDS.link] = link;

      const createRes = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AIRTABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fields, typecast: true }),
        }
      );

      if (!createRes.ok) {
        const err = await createRes.text();
        console.error("Airtable create error:", err);
        toolResultContent =
          "ERROR: Failed to save. Tell the user to try again later.";
      } else {
        toolResultContent = `SUCCESS: "${title}" (${type}) has been saved. Thank the user warmly and ask if they have anything else to share with the community.`;
      }
    }

    // Second API call with tool result
    const followUpMessages = [
      ...messages,
      { role: "assistant", content: data.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: toolResultContent,
          },
        ],
      },
    ];

    const followUpData = await callClaude(ANTHROPIC_KEY, {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages: followUpMessages,
    });

    if (!followUpData) {
      const fallback = isDuplicate
        ? "Looks like that's already been submitted! Got anything else to share?"
        : "Got it — your submission has been saved! Thanks for sharing. Got anything else?";
      return json(200, { reply: fallback, tool_used: true, duplicate: isDuplicate });
    }

    const finalText = followUpData.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    return json(200, {
      reply: finalText,
      tool_used: true,
      duplicate: isDuplicate,
    });
  } catch (err) {
    console.error("Function error:", err);
    return json(500, { error: "Internal error" });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function escapeSingleQuotes(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

export const config = {
  path: "/api/chat",
};
