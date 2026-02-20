import { TemplateType, EmailContent } from "../ai/emailComposer";
import fs from "node:fs/promises";
import path from "node:path";
import Handlebars from "handlebars";
import mjml2html from "mjml";

const templateFiles: Record<TemplateType, string> = {
  introduction: "introduction.mjml",
  followup: "followup.mjml",
  status_update: "update.mjml",
  escalation: "escalation.mjml",
};

const compiledTemplates = new Map<string, Handlebars.TemplateDelegate>();

export const renderTemplate = async (template: TemplateType, content: EmailContent): Promise<string> => {
  const fileName = templateFiles[template];
  const templatePath = path.join(__dirname, "../templates", fileName);

  let templateFn = compiledTemplates.get(fileName);
  if (!templateFn) {
    const source = await fs.readFile(templatePath, "utf-8");
    templateFn = Handlebars.compile(source);
    compiledTemplates.set(fileName, templateFn);
  }

  const filledMjml = templateFn(content);
  const { html, errors } = mjml2html(filledMjml, { validationLevel: "strict" });

  if (errors.length) {
    throw new Error("MJML validation failed");
  }

  return html;
};
