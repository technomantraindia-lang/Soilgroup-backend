function createSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const categorySeed = [
  {
    name: 'Bio Fertilizers',
    slug: 'bio-fertilizers',
    description: 'Living microorganisms that naturally improve nutrient availability and crop resilience.',
  },
  {
    name: 'Bio Stimulants',
    slug: 'bio-stimulants',
    description: 'Advanced plant growth boosters for better stress tolerance and development.',
  },
  {
    name: 'Organic Fertilizers',
    slug: 'organic-fertilizers',
    description: 'Nature-based fertilizers for balanced nutrition and healthy crop growth.',
  },
  {
    name: 'Organic Manure',
    slug: 'organic-manure',
    description: 'Premium organic manure that improves soil texture and microbial activity.',
  },
  {
    name: 'Soil Conditioners',
    slug: 'soil-conditioners',
    description: 'Restore and maintain soil health with powerful conditioning inputs.',
  },
  {
    name: 'Chelated Micronutrients',
    slug: 'chelated-micronutrients',
    description: 'Targeted chelated micronutrients for quick correction of nutrient deficiencies.',
  },
  {
    name: 'Water Soluble Fertilizers',
    slug: 'water-soluble-fertilizers',
    description: 'Fast-acting water soluble fertilizers for fertigation and foliar applications.',
  },
  {
    name: 'Growing Media',
    slug: 'growing-media',
    description: 'Reliable growing media for healthy root development and better establishment.',
  },
]

const productSeed = [
  { name: 'Bio NPK', categorySlug: 'bio-fertilizers', shortDescription: 'Bio-based NPK support for consistent growth.' },
  { name: 'Compost Active', categorySlug: 'bio-fertilizers', shortDescription: 'Accelerates decomposition and nutrient release.' },
  { name: 'Fe-Mob', categorySlug: 'bio-fertilizers', shortDescription: 'Improves iron mobilization in the rhizosphere.' },
  { name: 'K-Mob', categorySlug: 'bio-fertilizers', shortDescription: 'Supports potassium mobilization for crops.' },
  { name: 'Myco-V', categorySlug: 'bio-fertilizers', shortDescription: 'Mycorrhiza-based inoculant for root vigor.' },
  { name: 'N-Azo', categorySlug: 'bio-fertilizers', shortDescription: 'Nitrogen fixing bio input for healthy growth.' },
  { name: 'P-Sob', categorySlug: 'bio-fertilizers', shortDescription: 'Improves phosphorus solubilization in soil.' },
  { name: 'Zn-Mob', categorySlug: 'bio-fertilizers', shortDescription: 'Zinc mobilizer for better micronutrient uptake.' },
  { name: 'Amino 80', categorySlug: 'bio-stimulants', shortDescription: 'Amino-acid based stimulant for stress recovery.' },
  { name: 'Bloom Force', categorySlug: 'bio-stimulants', shortDescription: 'Flowering booster for better fruit set.' },
  { name: 'Fulvic Fresh', categorySlug: 'bio-stimulants', shortDescription: 'Fulvic support for nutrient absorption.' },
  { name: 'Grow Force', categorySlug: 'bio-stimulants', shortDescription: 'Vegetative growth support for stronger plants.' },
  { name: 'Potassium Phosphite', categorySlug: 'bio-stimulants', shortDescription: 'Phosphite support for vigor and resilience.' },
  { name: 'Bone Meal', categorySlug: 'organic-fertilizers', shortDescription: 'Organic phosphorus-rich fertilizer for rooting.' },
  { name: 'NPK (5-10-0)', categorySlug: 'organic-fertilizers', shortDescription: 'Balanced nutrition with higher phosphorus ratio.' },
  { name: 'NPK (5-10-5)', categorySlug: 'organic-fertilizers', shortDescription: 'Complete nutrition for broad crop stages.' },
  { name: 'Nitro +', categorySlug: 'organic-fertilizers', shortDescription: 'Organic nitrogen support for lush vegetative growth.' },
  { name: 'P-Bloom', categorySlug: 'organic-fertilizers', shortDescription: 'Promotes flowering and fruit development.' },
  { name: 'Bio Organic Manure', categorySlug: 'organic-manure', shortDescription: 'Soil-enriching organic manure for long-term fertility.' },
  { name: 'CT Compost', categorySlug: 'organic-manure', shortDescription: 'High-quality compost for active microbial life.' },
  { name: 'Mush Compost', categorySlug: 'organic-manure', shortDescription: 'Nutrient-rich compost to improve soil structure.' },
  { name: 'Vermicompost', categorySlug: 'organic-manure', shortDescription: 'Earthworm-derived compost for balanced nutrients.' },
  { name: 'Cake Mixture', categorySlug: 'soil-conditioners', shortDescription: 'Blended cakes to improve soil health and tilth.' },
  { name: 'Castor Cake', categorySlug: 'soil-conditioners', shortDescription: 'Organic cake for gradual nutrient release.' },
  { name: 'Cotton Seed Cake', categorySlug: 'soil-conditioners', shortDescription: 'Adds organic matter and supports soil biology.' },
  { name: 'Groundnut DOC', categorySlug: 'soil-conditioners', shortDescription: 'Enhances soil organic carbon and productivity.' },
  { name: 'Gypsum', categorySlug: 'soil-conditioners', shortDescription: 'Improves soil structure and calcium-sulfur balance.' },
  { name: 'Potassium Humate', categorySlug: 'soil-conditioners', shortDescription: 'Humate-based conditioner for stronger root systems.' },
  { name: 'Rock Phosphate', categorySlug: 'soil-conditioners', shortDescription: 'Slow-release phosphorus source for soil enrichment.' },
]

export const DEFAULT_CATEGORY_SEED = categorySeed

export const DEFAULT_PRODUCT_SEED = productSeed.map((product) => ({
  ...product,
  slug: createSlug(product.name),
  description: '',
  imageUrl: '',
  status: 'published',
}))
