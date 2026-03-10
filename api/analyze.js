module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple app token verification
  const appToken = req.headers['x-app-token'];
  if (appToken !== process.env.APP_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const { image_base64, mime_type } = req.body;

    if (!image_base64) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const systemPrompt = `You are an expert AI dermatology assistant. Analyze the provided skin lesion image and return a structured JSON assessment.

IMPORTANT DISCLAIMERS TO FOLLOW:
- You are NOT providing a medical diagnosis
- Always recommend consulting a board-certified dermatologist
- Be thorough but appropriately cautious
- If image quality is poor, indicate lower confidence

Analyze the lesion using the ABCDE criteria:
- A (Asymmetry): Is the lesion symmetric or asymmetric?
- B (Border): Are the borders regular/smooth or irregular/ragged?
- C (Color): Is the color uniform or are there multiple colors?
- D (Diameter): Estimate relative size from the image context
- E (Evolution): Note any visible signs of change (crusting, bleeding, etc.)

Return ONLY valid JSON in this exact format (no markdown, no code fences):
{
    "risk_level": "low" | "moderate" | "high",
    "confidence": 0.0-1.0,
    "classification": "one of: Benign Nevus (Mole), Atypical Nevus, Seborrheic Keratosis, Dermatofibroma, Basal Cell Carcinoma, Squamous Cell Carcinoma, Melanoma, Actinic Keratosis, Vascular Lesion, Unknown",
    "overall_score": 0.0-1.0,
    "abcde_scores": {
        "asymmetry": { "score": 0.0-1.0, "description": "brief finding" },
        "border": { "score": 0.0-1.0, "description": "brief finding" },
        "color": { "score": 0.0-1.0, "description": "brief finding" },
        "diameter": { "score": 0.0-1.0, "description": "brief finding" },
        "evolution": { "score": 0.0-1.0, "description": "brief finding" }
    },
    "recommendations": ["recommendation 1", "recommendation 2", "..."],
    "analysis_notes": "Brief overall assessment paragraph"
}

Score meanings: 0.0 = completely normal/benign characteristics, 1.0 = highly concerning characteristics.
Risk levels: low (overall < 0.3), moderate (0.3-0.55), high (> 0.55).

Be accurate and evidence-based. If the image is not a skin lesion, indicate that in your response with a low confidence score.`;

    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResponse = await fetch(geminiURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                inline_data: {
                  mime_type: mime_type || 'image/jpeg',
                  data: image_base64
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json'
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }
        ]
      })
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error('Gemini API error:', geminiResponse.status, errorBody);
      return res.status(502).json({ error: 'AI analysis failed', detail: geminiResponse.status });
    }

    const geminiData = await geminiResponse.json();
    const analysisText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!analysisText) {
      return res.status(502).json({ error: 'No analysis returned from AI' });
    }

    const analysis = JSON.parse(analysisText);

    return res.status(200).json({
      success: true,
      analysis: analysis
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
