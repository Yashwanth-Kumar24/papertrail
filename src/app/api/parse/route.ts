import { NextRequest, NextResponse } from 'next/server'

const PROMPT = `You are a receipt parser. Extract structured data from this OCR text.
Return ONLY valid JSON with this exact structure, no explanation, no markdown:
{
  "store_name": "string",
  "location": "string or null",
  "purchase_date": "YYYY-MM-DD or null",
  "purchase_time": "HH:MM or null",
  "transaction_id": "string or null",
  "total": "number or null",
  "items": [
    {
      "item_code": "string or null",
      "name": "string",
      "original_price": "number",
      "discount_amount": "number",
      "final_price": "number"
    }
  ]
}
Rules:
- Lines starting with 0000 are discount lines — pair with their item by matching the item code after the slash, do NOT list as separate items
- final_price = original_price - discount_amount, never allow negative final_price, minimum 0
- Tax code letters E A F H before or after item codes are NOT part of the item code
- item_code is digits only, 3-8 digits
- Stars or asterisks before item names (***) are NOT part of the name
- Ignore these lines entirely: SUBTOTAL, TAX, TOTAL, CHANGE, APPROVED, AMOUNT, VISA, WALLET, THANK YOU, PLEASE COME AGAIN, member numbers
- If an item appears twice with same code and price it was bought twice — keep both rows
- Return null for fields you cannot determine with confidence
- When a tax code letter (E, A, F, H) is immediately followed by digits with no space like E1801, the item code is the digits only: 1801
- Smart quotes, regular quotes, dashes, and symbols before item names are noise — ignore them and extract the name
- Lines with format like "RE — E1801 "MANDARIN 4.99" mean: code=1801, name=MANDARIN, price=4.99
Example of noisy OCR lines and how to parse them:
"RE — E1801 "MANDARIN 4.99" → item_code: "1801", name: "MANDARIN", price: 4.99
"| 1943125 GAP LOGO-TEE 9.99 A" → item_code: "1943125", name: "GAP LOGO-TEE", price: 9.99
"7 [BEY SES0 38 OG GALA 4.99" → item_code: null, name: "OG GALA", price: 4.99
"0000375262 / 1982330 5.00-A" → discount of 5.00 for item 1982330, not a separate item`


export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()
    if (!text) return NextResponse.json({ error: 'No text' }, { status: 400 })

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user',   content: text },
        ],
        max_tokens: 2000,
        temperature: 0,
      }),
    })

    if (!response.ok) {
      const err = await response.json()
      console.error('OpenAI error:', err)
      return NextResponse.json({ error: 'OpenAI request failed' }, { status: 502 })
    }

    const data   = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return NextResponse.json({ error: 'Empty response from OpenAI' }, { status: 502 })

    const parsed = JSON.parse(content)
    return NextResponse.json(parsed)

  } catch (e: any) {
    console.error('Parse route error:', e)
    return NextResponse.json({ error: e.message ?? 'Unknown error' }, { status: 500 })
  }
}