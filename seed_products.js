import fs from 'fs';
import { MongoClient } from 'mongodb';
import dns from 'dns';

dns.setServers(['8.8.8.8', '8.8.4.4']);
const URI = 'mongodb+srv://chetansuthar1546:65FY6jzaqkUQg5fm@cluster0.dcoskyt.mongodb.net/product';

const NAME_MAP = {
  'BIO NPK': 'Bio NPK',
  'FE-Mob': 'FE-Mob',
  'ZN-Mob': 'ZN-Mob',
  'N-Azos': 'N-Azo', // Map N-Azos to N-Azo if they are the same, or maybe skip? We'll map to N-Azo
  'N-Azo': 'N-Azo',
  'N-Aceto': 'N-Aceto',
  'N-Rhizo': 'N-Rhizo',
  'K-Mob': 'K-Mob',
  'Myco-V': 'Myco-V',
  'P-Sob': 'P-Sob',
  'Compost Active': 'Compost Active',
  'NPK+': 'NPK+',
  'Organic Slow-Release Fertilizer & Soil Conditioner (Oilcake Manure)': 'Cotton Seed Cake', // Best guess? Let's skip complex ones if unsure, or map by substring later
  'Organic Oil-Cake Fertilizer & Soil Conditioner (Mahua Seed Residue)': 'Cake Mixture', // Skip
  'Organic Groundnut Cake Fertilizer & Soil Conditioner (Groundnut DOC)': 'Groundnut DOC',
  'Karanj Cake': 'Castor Cake', // No Karanj Cake in DB, skip
  'Castor Cake': 'Castor Cake',
  'CT Compost': 'CT Compost',
  'Bio Organic Manure': 'Bio Organic Manure',
  'P-ROM': 'P-ROM',
  'Vermicompost': 'Vermicompost',
  'Neem Fruit-P': 'Neem Fruit-P',
  'Cake Mixture': 'Cake Mixture',
  'Mush Compost': 'Mush Compost',
  'Rock Phosphate': 'Rock Phosphate',
  'Gypsum': 'Gypsum',
  'Grow Force': 'Grow Force',
  'Bloom Force': 'Bloom Force',
  'Yield Force': 'Yield Force',
  'Bone Meal (Steamed)': 'Bone Meal'
};

function parseExtractedText(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\n\n+/g, '\n\n');
  text = text.replace(/&amp;/g, '&');
  
  const products = [];
  const blocks = text.split('Contents (Table of Contents)');
  
  for (let i = 1; i < blocks.length; i++) {
    const prevBlock = blocks[i-1];
    let currBlock = blocks[i];
    
    const prevLines = prevBlock.trim().split('\n').map(l=>l.trim()).filter(Boolean);
    let productNameFull = prevLines[prevLines.length - 1];
    let productName = productNameFull.split(/-\s/)[0].trim();
    
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
    let contentsText = '';
    
    if (whatItIsStart !== -1) {
       contentsText = currBlock.substring(0, whatItIsStart).trim();
       whatItIsStart += 'What it is & How it works'.length;
       if (whatItIsEnd !== -1 && whatItIsEnd > whatItIsStart) {
         whatItIs = currBlock.substring(whatItIsStart, whatItIsEnd).trim();
       } else {
         whatItIs = currBlock.substring(whatItIsStart).trim();
       }
    } else {
       contentsText = currBlock.substring(0, whatItIsEnd !== -1 ? whatItIsEnd : 200).trim();
    }
    
    const contents = [];
    let contentsNote = '';
    
    // Parse contentsText
    const cLines = contentsText.split('\n').map(l=>l.trim()).filter(Boolean);
    
    // Check if it's table format (Parameter, Specification, Key, Val, Key, Val)
    if (cLines[0] === 'Parameter' && cLines[1] === 'Specification') {
       for(let j=2; j<cLines.length; j+=2) {
         if (cLines[j].startsWith('(')) {
            contentsNote = cLines.slice(j).join(' ');
            break;
         }
         if (cLines[j+1] && !cLines[j+1].startsWith('(')) {
            contents.push({ parameter: cLines[j], specification: cLines[j+1] });
         } else {
            contents.push({ parameter: cLines[j], specification: '' });
            if (cLines[j+1] && cLines[j+1].startsWith('(')) {
               contentsNote = cLines.slice(j+1).join(' ');
               break;
            }
         }
       }
    } else {
       // Not a table. Just lines.
       for (const line of cLines) {
          if (line.startsWith('(')) {
             contentsNote += (contentsNote ? ' ' : '') + line;
          } else if (line.includes('–')) {
             const parts = line.split('–');
             contents.push({ parameter: parts[0].trim(), specification: parts.slice(1).join('–').trim() });
          } else if (line.includes('|')) {
             const parts = line.split('|');
             contents.push({ parameter: parts[0].trim(), specification: parts.slice(1).join('|').trim() });
          } else if (line.includes(':') && line.split(':')[0].split(' ').length <= 4) {
             const parts = line.split(':');
             contents.push({ parameter: parts[0].trim(), specification: parts.slice(1).join(':').trim() });
          } else {
             contents.push({ parameter: line, specification: '' });
          }
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
      _parsedName: productName,
      what_it_is: whatItIs,
      key_benefits: keyBenefits,
      when_to_use: whenToUse,
      recommended_crops: crops,
      application_dosage: applicationDosage,
      learn_more: learnMore,
      contents: contents,
      contentsNote: contentsNote
    });
  }
  return products;
}

async function run() {
  const text = fs.readFileSync('temp_extracted.txt', 'utf8');
  const parsed = parseExtractedText(text);
  
  const client = new MongoClient(URI);
  try {
    await client.connect();
    const db = client.db();
    const productsColl = db.collection('products');
    
    const dbProducts = await productsColl.find({}).toArray();
    let matchedCount = 0;
    
    for (const p of parsed) {
      let mappedName = NAME_MAP[p._parsedName];
      if (!mappedName) {
         // fallback: see if the exact parsed name matches a DB product
         const match = dbProducts.find(x => x.name === p._parsedName);
         if (match) mappedName = match.name;
      }
      
      if (mappedName) {
        const match = dbProducts.find(x => x.name === mappedName);
        if (match) {
          console.log(`Matched DOCX "${p._parsedName}" -> DB "${match.name}"`);
          const updateDoc = {
            what_it_is: p.what_it_is,
            key_benefits: p.key_benefits,
            when_to_use: p.when_to_use,
            recommended_crops: p.recommended_crops,
            application_dosage: p.application_dosage,
            learn_more: p.learn_more,
            contents: p.contents,
            contentsNote: p.contentsNote
          };
          await productsColl.updateOne({ _id: match._id }, { $set: updateDoc });
          matchedCount++;
        }
      } else {
        console.log(`NO MATCH for DOCX "${p._parsedName}"`);
      }
    }
    console.log(`Successfully updated ${matchedCount} products.`);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

run();
