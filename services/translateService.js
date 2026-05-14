const {
  TranslateClient,
  TranslateTextCommand
} = require("@aws-sdk/client-translate");

require("dotenv").config();

const translateClient = new TranslateClient({
  region: process.env.AWS_REGION
});

async function translateText(text, sourceLanguage, targetLanguage) {
  if (!text || sourceLanguage === targetLanguage) {
    return text;
  }

  try {
    const command = new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: sourceLanguage,
      TargetLanguageCode: targetLanguage
    });

    const result = await translateClient.send(command);

    return result.TranslatedText;
  } catch (error) {
    console.error("Amazon Translate no disponible. Usando texto original:", error.name);

    return text;
  }
}

module.exports = {
  translateText
};