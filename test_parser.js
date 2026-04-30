import fs from 'fs';

function parseExtractedText(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\n\n+/g, '\n\n');
  text = text.replace(/&amp;/g, '&');
  
  const products = [];
  const blocks = text.split('Contents (Table of Contents)');
  
  for (let i = 1; i < blocks.length; i++) {
    const prevBlock = blocks[i-1];
    let currBlock = blocks[i];
    
    // Product Name is the very last non-empty line of prevBlock.
    const prevLines = prevBlock.trim().split('\n').map(l=>l.trim()).filter(Boolean);
    let productName = prevLines[prevLines.length - 1];
    // Often formatted as "FE-Mob- Iron Chlorophyll..."
    // We'll just split by "- " instead of "-"
    productName = productName.split(/-\s/)[0].trim();
    if (productName.includes('-')) {
       // if it's still something like "N-Aceto", good.
    }
    
    // Remove the NEXT product's header from currBlock if this isn't the last block
    if (i < blocks.length - 1) {
       // The next product's header is at the end of currBlock.
       // We can just find the last "1️⃣", "2️⃣", "3️⃣" section and cut off after it.
       // Actually, it doesn't matter much if we just search for "Key Benefits", etc.
    }
    
    const extractSection = (startKeyword, endKeywords) => {
      let startIndex = currBlock.indexOf(startKeyword);
      if (startIndex === -1) return '';
      startIndex += startKeyword.length;
      
      let endIndex = currBlock.length;
      for (const ek of endKeywords) {
        const ei = currBlock.indexOf(ek, startIndex);
        if (ei !== -1 && ei < endIndex) {
          endIndex = ei;
        }
      }
      return currBlock.substring(startIndex, endIndex).trim();
    };
    
    let whatItIsEnd = currBlock.indexOf('Key Benefits');
    if (whatItIsEnd === -1) whatItIsEnd = currBlock.indexOf('Primary Use');
    let whatItIs = '';
    
    let whatItIsStart = currBlock.indexOf('What it is & How it works');
    if (whatItIsStart !== -1) {
       whatItIsStart += 'What it is & How it works'.length;
       if (whatItIsEnd !== -1 && whatItIsEnd > whatItIsStart) {
         whatItIs = currBlock.substring(whatItIsStart, whatItIsEnd).trim();
       } else {
         whatItIs = currBlock.substring(whatItIsStart).trim();
       }
    }
    
    const keyBenefitsText = extractSection('Key Benefits', ['Primary Use', 'When to Use', 'Crops']);
    const keyBenefits = keyBenefitsText.split('\n').map(l => l.replace(/^[•\-*0-9.]\s*/, '').trim()).filter(Boolean);
    
    const whenToUseText = extractSection('When to Use', ['Crops', 'Application']);
    const whenToUse = whenToUseText.split('\n').map(l => l.replace(/^[•\-*0-9.]\s*/, '').trim()).filter(Boolean);
    
    const cropsText = extractSection('Crops', ['Application']);
    const crops = cropsText.split('\n').map(l => l.replace(/^[•\-*0-9.]\s*/, '').replace(/^Suitable for:/i, '').replace(/^Recommended for:/i, '').trim()).filter(Boolean);
    
    const applicationText = extractSection('Application & Dosage', ['Availability', '1️⃣']);
    const applicationLines = applicationText.split('\n').map(l=>l.trim()).filter(Boolean);
    const applicationDosage = [];
    let currentMethod = null;
    for(const line of applicationLines) {
      if(line.includes(':') && !line.match(/^(Mix|Apply|Coat|Dip)/i)) {
        currentMethod = { method: line.replace(/:/g, '').trim(), steps: [] };
        applicationDosage.push(currentMethod);
      } else if (currentMethod) {
        currentMethod.steps.push(line.replace(/^[•\-*]\s*/, ''));
      } else {
        applicationDosage.push({ method: 'General', steps: [line.replace(/^[•\-*]\s*/, '')] });
      }
    }
    
    const leadsToText = extractSection('1️⃣', ['2️⃣', productName]);
    const happenText = extractSection('2️⃣', ['3️⃣', productName]);
    const fixesText = extractSection('3️⃣', ['Bio Fertilizers', 'Organic Fertilizers', 'Water Soluble', 'Micro Nutrients', productName, '\n\n\n\n\n']);
    
    const learnMore = [];
    if(leadsToText) learnMore.push({ title: 'Deficiency Leads To', content: leadsToText.replace(/.*?Leads To…/i, '').replace(/.*?Leads To/i, '').trim() });
    if(happenText) learnMore.push({ title: 'Why Deficiency Happens', content: happenText.replace(/.*?Happen\?/i, '').replace(/.*?Happen/i, '').trim() });
    if(fixesText) learnMore.push({ title: 'How This Product Fixes It', content: fixesText.replace(/.*?Fixes It/i, '').trim() });
    
    products.push({
      name: productName,
      what_it_is: whatItIs,
      key_benefits: keyBenefits,
      when_to_use: whenToUse,
      recommended_crops: crops,
      application_dosage: applicationDosage,
      learn_more: learnMore
    });
  }
  return products;
}

const text = fs.readFileSync('temp_extracted.txt', 'utf8');
const p = parseExtractedText(text);
console.log(p.map(x => x.name));
