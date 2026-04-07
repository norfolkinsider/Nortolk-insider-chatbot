// netlify/functions/chat.mjs
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
    };

    const systemPrompt = `You are the Norfolk Insider community tip bot. People from Norfolk County, Ontario share things with you — events, birthdays, anniversaries, local news, business updates, or anything they think their neighbours should know about.

Your job:
1. Greet the visitor warmly. Ask what they'd like to share with the community.
2. Have a natural conversation to understand what they're telling you.
3. Extract the relevant details and call the submit_tip tool when ready.

What you need to collect:
- **Title**: A short name/title for the submission (e.g. "Felicia McMinn Live at Barrel", "Bob Smith's 80th Birthday", "New bakery opening on Norfolk St")
- **Type**: Classify as one of: Event, Birthday, Anniversary, Community News, Business Update, or Other
- **Blurb**: A natural 1-3 sentence description. Write it the way you'd tell a neighbour. Examples:
  - "Felicia McMinn is playing live music this Saturday night at Barrel Restaurant in Port Dover — doors at 7!"
  - "Bob Smith is turning 80 on April 12th! His family is throwing a party at the Simcoe Legion and everyone's welcome."
  - "Norfolk Brewing just announced they're expanding into the old hardware store on Main Street in Simcoe. Expected to open by summer."
- **Date**: In YYYY-MM-DD format. For events, the event date. For birthdays/anniversaries, the date of the milestone. For news, today's date if no specific date applies. If they say "this Saturday", calculate from today (${new Date().toISOString().split("T")[0]}).
- **Location**: The town in Norfolk County — Simcoe, Port Dover, Delhi, Waterford, Port Rowan, or Norfolk County (for county-wide items). Ask if unclear.
- **Submitter Name**: Optionally ask "And can I put your name on this, or would you rather stay anonymous?" Don't push if they decline.

If any critical detail is missing (what it is, when, where), ask conversationally. Don't interrogate — keep it friendly and brief.

After submission, thank them warmly and ask if they have anything else to share.

Guidelines:
- Be genuinely warm, casual, and community-focused. You're the town crier, not a form.
- Keep responses to 2-3 sentences max.
- If someone shares something that doesn't fit neatly into a category, use "Other" — accept anything.
- Never refuse a submission. If it's about Norfolk County, it belongs here.`;

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
              description: "Natural 1-3 sentence description",
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
          },
        },
      },
    ];

    // First API call
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      console.error("Anthropic error:", err);
      return json(502, { error: "AI service error" });
    }

    const data = await apiRes.json();
    const toolUse = data.content.find((b) => b.type === "tool_use");

    if (!toolUse) {
      const text = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return json(200, { reply: text, tool_used: false });
    }

    const { title, type, blurb, date, location, submitter_name } =
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

    const followUpRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: followUpMessages,
      }),
    });

    const followUpData = await followUpRes.json();
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
