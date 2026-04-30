const fs = require('fs');
const { execSync } = require('child_process');

try {
  fs.mkdirSync('temp_docx', { recursive: true });
  execSync('tar -xf "../Soil+ Website Product Description.docx" -C temp_docx');
  const xml = fs.readFileSync('temp_docx/word/document.xml', 'utf8');
  const text = xml.replace(/<w:p[^>]*>/g, '\n').replace(/<[^>]+>/g, '');
  console.log(text);
  fs.rmSync('temp_docx', { recursive: true, force: true });
} catch (e) {
  console.error(e);
}
