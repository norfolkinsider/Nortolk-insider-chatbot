# Norfolk Insider Event Chatbot

A Netlify-hosted chatbot that lets community members submit events to The Norfolk Insider via natural conversation. Events are stored in Airtable.

## How It Works

1. Visitor opens the chat page
2. They describe an event naturally ("There's a craft market at the Simcoe fairgrounds this Saturday from 9-3")
3. Claude extracts: event name, date, blurb, and location
4. The function checks Airtable for duplicates (same name + same date)
5. If no duplicate, it creates the record; if duplicate, it tells the user

## Setup

### 1. Environment Variables

In your Netlify site dashboard → Site Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `AIRTABLE_API_KEY` | Your Airtable personal access token |

### 2. Deploy

Push this folder to a GitHub repo connected to Netlify, or drag-and-drop deploy via Netlify dashboard.

### 3. Airtable

Events go to:
- **Base**: `appAtE1hE5frgdQFo` (Untitled Base)
- **Table**: `tblxnJEq6aeYI8BYM` (Insider Events)

Fields used:
- Event Blurb (primary) — natural language description
- Event Name — short name for duplicate detection
- Event Date — ISO date for filtering
- Location — town/city select
- Source — "Website Chatbot" or "Bradley via Claude"
- Status — for editorial workflow

## Embedding on Another Site

To embed this on norfolkinsider.com, use an iframe:

```html
<iframe
  src="https://your-netlify-site.netlify.app"
  width="100%"
  height="600"
  frameborder="0"
  style="max-width: 520px; border-radius: 12px; border: 1px solid #e8e2d8;"
></iframe>
```

## Cost

Uses Claude Sonnet 4 — typically ~$0.003 per conversation turn. At 50 events/month, expect < $1/month in API costs.
