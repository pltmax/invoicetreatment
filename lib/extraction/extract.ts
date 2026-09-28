import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractedInvoiceSchema, EXTRACTION_CATEGORIES, type ExtractedInvoice } from "./schema";

const client = new Anthropic();

export class ExtractionError extends Error {}

export async function extractInvoiceFromPdf(pdfBase64: string): Promise<ExtractedInvoice> {
  let response;
  try {
    response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            {
              type: "text",
              text: `Extract this invoice's data. If a field is genuinely unreadable, make your best reasonable estimate rather than leaving it blank. For "category", choose the closest fit from: ${EXTRACTION_CATEGORIES.join(", ")}.`,
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ExtractedInvoiceSchema) },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ExtractionError(
        "Clé API Anthropic manquante ou invalide — ajoutez ANTHROPIC_API_KEY dans .env.local."
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new ExtractionError(`Erreur de l'API Claude : ${err.message}`);
    }
    throw err;
  }

  if (!response.parsed_output) {
    throw new ExtractionError(
      "Impossible d'extraire les données de ce PDF. Vérifiez qu'il s'agit bien d'une facture lisible."
    );
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO_DATE.test(response.parsed_output.issueDate) || !ISO_DATE.test(response.parsed_output.dueDate)) {
    throw new ExtractionError(
      "Impossible d'extraire les dates de cette facture. Vérifiez qu'il s'agit bien d'une facture lisible."
    );
  }

  return response.parsed_output;
}
