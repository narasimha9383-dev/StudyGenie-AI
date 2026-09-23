const fs = require("fs");
const path = require("path");
const { renderStudyMaterialPdf } = require("../backend/services/pdfService");

const fixturePath = path.join(__dirname, "fixtures", "sample_document.json");
const outputPath = path.join(__dirname, "fixtures", "sample_document.pdf");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

renderStudyMaterialPdf({
  filePath: outputPath,
  title: fixture.title,
  notes: fixture.notes,
  questions: fixture.questions_answers,
  generationType: "qa",
  sourceText: "Generative Adversarial Networks and diffusion models",
}).then(() => {
  process.stdout.write(outputPath);
}).catch((error) => {
  process.stderr.write(error.stack || error.message);
  process.exitCode = 1;
});
