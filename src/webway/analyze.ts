import type {
  Artifact,
  Concept,
  SemanticLink,
  KnowledgeRegion,
  MentalModel,
  WebwayAnalysisResult,
  SemanticRelationshipType,
} from './types.js';

const ANALYSIS_VERSION = '0.1.0';
const MAX_CONCEPTS = 5;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'it', 'its', 'this',
  'that', 'these', 'those', 'and', 'but', 'or', 'nor', 'so', 'yet',
  'not', 'no', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'each', 'more', 'most', 'other', 'such', 'only',
  'same', 'than', 'then', 'when', 'where', 'which', 'while', 'who',
  'how', 'all', 'also', 'if', 'up', 'out', 'about', 'what', 'we', 'our',
  'they', 'their', 'he', 'she', 'you', 'your', 'my', 'i', 'me', 'him',
  'her', 'us', 'them', 'any', 'some', 'one', 'two', 'new', 'use', 'used',
]);

interface RegionProfile {
  id: string;
  name: string;
  description: string;
  keywords: string[];
}

const REGION_PROFILES: RegionProfile[] = [
  {
    id: 'kr-software-engineering',
    name: 'Software Engineering',
    description: 'Code structure, APIs, testing, and software design patterns',
    keywords: [
      'code', 'function', 'module', 'api', 'test', 'class', 'type',
      'interface', 'component', 'service', 'build', 'deploy', 'library',
      'package', 'dependency', 'refactor',
    ],
  },
  {
    id: 'kr-cognitive-architecture',
    name: 'Cognitive Architecture',
    description: 'Memory systems, semantic understanding, knowledge representation, and mental models',
    keywords: [
      'memory', 'concept', 'knowledge', 'model', 'pattern', 'learn',
      'semantic', 'schema', 'mental', 'structure', 'cognitive', 'reasoning',
      'understand', 'insight', 'abstract',
    ],
  },
  {
    id: 'kr-data-systems',
    name: 'Data Systems',
    description: 'Storage, retrieval, transformation, and management of structured information',
    keywords: [
      'data', 'database', 'query', 'schema', 'index', 'store', 'record',
      'table', 'graph', 'vector', 'pipeline', 'transform', 'aggregate',
      'stream', 'cache',
    ],
  },
  {
    id: 'kr-general',
    name: 'General',
    description: 'Cross-domain knowledge without a clear primary region',
    keywords: [],
  },
];

const LINK_ROTATION: SemanticRelationshipType[] = ['relates-to', 'extends', 'depends-on'];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function buildFrequencyMap(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  return freq;
}

function extractTopWords(freq: Map<string, number>, n: number): Array<[string, number]> {
  return [...freq.entries()]
    .sort(([wordA, countA], [wordB, countB]) => countB - countA || wordA.localeCompare(wordB))
    .slice(0, n);
}

function scoreRegion(conceptLabels: string[], profile: RegionProfile): number {
  return conceptLabels.reduce((score, label) => {
    const hits = profile.keywords.filter(kw => label.includes(kw) || kw.includes(label)).length;
    return score + hits;
  }, 0);
}

function suggestRegion(concepts: Concept[]): KnowledgeRegion {
  const labels = concepts.map(c => c.label);
  let best = REGION_PROFILES[REGION_PROFILES.length - 1]; // fallback: general
  let bestScore = 0;

  for (const profile of REGION_PROFILES) {
    if (profile.id === 'kr-general') continue;
    const score = scoreRegion(labels, profile);
    if (score > bestScore) {
      bestScore = score;
      best = profile;
    }
  }

  return {
    id: best.id,
    name: best.name,
    description: best.description,
    conceptIds: concepts.map(c => c.id),
  };
}

/**
 * Deterministic prototype: extracts concepts and semantic links from a single Artifact.
 * No LLM calls, no external storage. Pure signal extraction via frequency analysis.
 */
export function analyzeArtifact(artifact: Artifact): WebwayAnalysisResult {
  const tokens = tokenize(artifact.content);
  const freq = buildFrequencyMap(tokens);
  const topWords = extractTopWords(freq, MAX_CONCEPTS);
  const maxCount = topWords.length > 0 ? topWords[0][1] : 1;

  const concepts: Concept[] = topWords.map(([label, count], idx) => ({
    id: `${artifact.id}-concept-${idx}`,
    label,
    weight: count / maxCount,
    sourceArtifactId: artifact.id,
  }));

  const links: SemanticLink[] = [];
  for (let i = 0; i + 1 < concepts.length; i++) {
    links.push({
      id: `${artifact.id}-link-${i}`,
      fromConceptId: concepts[i].id,
      toConceptId: concepts[i + 1].id,
      relationshipType: LINK_ROTATION[i % LINK_ROTATION.length],
      strength: concepts[i + 1].weight,
    });
  }

  const suggestedRegion = suggestRegion(concepts);

  const topLabel = concepts.length > 0 ? concepts[0].label : 'unknown';
  const mentalModels: MentalModel[] = [
    {
      id: `${artifact.id}-model-0`,
      name: `${topLabel} cluster`,
      regionId: suggestedRegion.id,
      pattern: `Primary concept "${topLabel}" with ${concepts.length} related concept(s) in the ${suggestedRegion.name} region.`,
      confidence: concepts.length > 0 ? Math.round(concepts[0].weight * 80) / 100 : 0,
    },
  ];

  return {
    artifactId: artifact.id,
    concepts,
    links,
    suggestedRegion,
    mentalModels,
    analysisVersion: ANALYSIS_VERSION,
  };
}
