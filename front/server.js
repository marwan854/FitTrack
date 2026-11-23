require("dotenv").config();

const express = require("express");
const { GoogleGenAI } = require("@google/genai");

const app = express();

app.use(express.json({ limit: "200mb" }));
app.use(express.static(__dirname));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
  
});
function getResponseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];

  return parts
    .map(part => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}


app.post("/api/chat", async (req, res) => {
  console.log("📩 وصل طلب جديد للمدرب");

  try {
    const question = req.body.question || "";
    const coach = req.body.coach || "المدرب العام";
    const imageData = req.body.imageData;

    const history = Array.isArray(req.body.history)
      ? req.body.history.slice(-10).filter(message =>
          ["user", "model"].includes(message.role) &&
          Array.isArray(message.parts)
        )
      : [];

    console.log("هل توجد صورة؟", !!imageData);

    if (!question && !imageData) {
      return res.status(400).json({
        error: "اكتب سؤالك أو اختر صورة"
      });
    }

    const parts = [{
      text: `أنت ${coach} في FitTrack PRO.

أجب بالعربية بإجابة مختصرة ومباشرة في 3 إلى 5 سطور، إلا إذا طلب المستخدم شرحًا مفصلًا.

لا تخترع معلومات غير موجودة.

إذا أرسل المستخدم صورة، افهم محتواها واستخدمها في الإجابة.

سؤال المستخدم:
${question || "حلل الصورة المرفقة واشرح ما يظهر فيها."}`
    }];

    if (imageData) {
      const match = imageData.match(
        /^data:(image\/(?:jpeg|png|webp|heic|heif));base64,(.+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: "صيغة الصورة غير مدعومة"
        });
      }

      parts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2]
        }
      });
    }

    console.log("⏳ جاري إرسال الطلب إلى Gemini");

    let stream;
    let lastError;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        stream = await ai.models.generateContentStream({
          model: "gemini-3.5-flash-lite",
          contents: [
            ...history,
            { role: "user", parts }
          ]
        });

        break;

      } catch (error) {
        lastError = error;
        console.log("محاولة Gemini رقم:", attempt, error.message);

        if (error.status !== 503 || attempt === 3) {
          throw error;
        }

        await new Promise(resolve =>
          setTimeout(resolve, attempt * 500)
        );
      }
    }

    if (!stream) {
      throw lastError || new Error("لم يصل رد من Gemini");
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    console.log("✅ بدأ وصول الرد تدريجيًا");

    for await (const chunk of stream) {
      if (typeof chunk.text === "string" && chunk.text) {
        res.write(chunk.text);
      }
    }

    res.end();
    console.log("✅ انتهى إرسال الرد");

  } catch (error) {
    console.error("❌ GEMINI ERROR:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "خطأ في خدمة الذكاء الاصطناعي: " + error.message
      });
    } else {
      res.end();
    }
  }
});


app.post("/api/translate", async (req, res) => {
  try {
    const { texts, language } = req.body || {};

    if (!Array.isArray(texts) || !["ar", "en"].includes(language)) {
      return res.status(400).json({
        error: "بيانات الترجمة غير صحيحة"
      });
    }

    if (texts.length > 80) {
      return res.status(400).json({
        error: "عدد النصوص أكبر من المسموح"
      });
    }

    const cleanTexts = texts.map(text =>
      String(text).slice(0, 2000)
    );

    const targetLanguage =
      language === "en" ? "English" : "Arabic";

    const prompt = `
Translate the following website text items into ${targetLanguage}.

Rules:
- Return a valid JSON array only.
- Keep exactly the same number and order of items.
- Preserve numbers, emojis, symbols and meaning.
- Do not add explanations.
- Translate naturally for a fitness application.

Text items:
${JSON.stringify(cleanTexts)}
`;

    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt
    });

    let raw = result.text.trim()
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "");

    const translations = JSON.parse(raw);

    if (
      !Array.isArray(translations) ||
      translations.length !== cleanTexts.length
    ) {
      throw new Error("نتيجة الترجمة غير مكتملة");
    }

    res.json({
      translations: translations.map((item, index) =>
        typeof item === "string" ? item : cleanTexts[index]
      )
    });

  } catch (error) {
    console.error("TRANSLATION ERROR:", error);

    res.status(500).json({
      error: "تعذر ترجمة النصوص: " + error.message
    });
  }
});
app.listen(3000, () => {
  console.log("FitTrack PRO يعمل على http://localhost:3000");
});