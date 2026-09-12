// extractor.js — Temporal & Event Extraction Pipeline with Exact Provenance
// Architecture: Fast Rule-Based Regex → Chrono-Node → Strict LLM Fallback
// Inspired by: Su et al. (Temporal Information Extraction) & TEI2GO

const chrono = require('chrono-node');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Indian months lookup for fast regex temporal parsing
const MONTH_MAP = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

class Extractor {
  constructor() {
    this.geminiApiKey = process.env.GEMINI_API_KEY || '';
    this.genAI = this.geminiApiKey ? new GoogleGenerativeAI(this.geminiApiKey) : null;
  }

  // Format Date object to YYYY-MM-DD
  formatDate(d) {
    if (!d || isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }

  // Fast Rule-Based Temporal Extraction (Su et al. & TEI2GO)
  extractExplicitDeadlines(text) {
    if (!text) return null;

    const deadlinePatterns = [
      /(?:last\s*date|closing\s*date|apply\s*before|deadline|registration\s*closes|ends\s*on)[^\w\d]{0,20}(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(?:last\s*date|closing\s*date|apply\s*before|deadline|registration\s*closes|ends\s*on)[^\w\d]{0,20}(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s,]+202[5-9])/i,
      /(?:last\s*date|closing\s*date|apply\s*before|deadline|registration\s*closes|ends\s*on)[^\w\d]{0,20}((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?[\s,]+202[5-9])/i,
      /(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s,]+202[5-9])/i
    ];

    for (const pattern of deadlinePatterns) {
      const match = text.match(pattern);
      if (match) {
        const rawDateStr = match[1];
        // Parse with chrono-node
        const parsed = chrono.parseDate(rawDateStr);
        if (parsed) {
          // Extract sentence as provenance evidence
          const matchIndex = text.indexOf(match[0]);
          const start = Math.max(0, matchIndex - 30);
          const end = Math.min(text.length, matchIndex + match[0].length + 40);
          const evidence = text.substring(start, end).trim();

          return {
            deadline: this.formatDate(parsed),
            deadline_source_text: evidence,
            confidence: 'high'
          };
        }
      }
    }
    return null;
  }

  // Fast Rule-Based Qualification & Eligibility Extraction
  extractEligibility(text) {
    if (!text) return { qualification: 'Any', branch: 'Any', graduation_year: 'Any', location: 'India' };

    const lower = text.toLowerCase();
    const quals = [];
    if (lower.includes('b.tech') || lower.includes('btech') || lower.includes('b.e.') || lower.includes('be degree')) quals.push('B.Tech / B.E.');
    if (lower.includes('mca') || lower.includes('m.tech') || lower.includes('mtech')) quals.push('MCA / M.Tech');
    if (lower.includes('degree') || lower.includes('graduate') || lower.includes('graduation')) quals.push('Any Graduate');
    if (lower.includes('diploma')) quals.push('Diploma');
    if (lower.includes('12th') || lower.includes('intermediate') || lower.includes('10+2')) quals.push('12th / Intermediate');
    if (lower.includes('10th') || lower.includes('ssc') || lower.includes('matriculation')) quals.push('10th Standard');

    const branches = [];
    if (lower.includes('cse') || lower.includes('computer science') || lower.includes('information technology') || lower.includes(' it ')) branches.push('CSE / IT');
    if (lower.includes('ece') || lower.includes('electronics')) branches.push('ECE');
    if (lower.includes('mechanical')) branches.push('Mechanical');
    if (lower.includes('civil')) branches.push('Civil');

    const years = [];
    if (lower.includes('2024')) years.push('2024');
    if (lower.includes('2025')) years.push('2025');
    if (lower.includes('2026')) years.push('2026');
    if (lower.includes('2027')) years.push('2027');

    let location = 'India';
    if (lower.includes('andhra pradesh') || lower.includes('ap ')) location = 'Andhra Pradesh';
    else if (lower.includes('telangana') || lower.includes('hyderabad')) location = 'Telangana';
    else if (lower.includes('delhi') || lower.includes('new delhi')) location = 'New Delhi';

    return {
      qualification: quals.length ? quals.join(', ') : 'Any Graduate',
      branch: branches.length ? branches.join(', ') : 'Any Branch',
      graduation_year: years.length ? years.join(', ') : 'Any Year',
      location
    };
  }

  // Infer Organization Name
  inferOrganization(title, link, snippet) {
    const combined = `${title} ${link} ${snippet}`.toLowerCase();
    if (combined.includes('upsc')) return 'UPSC';
    if (combined.includes('ssc')) return 'SSC';
    if (combined.includes('rrb') || combined.includes('railway')) return 'RRB (Railways)';
    if (combined.includes('nta')) return 'National Testing Agency (NTA)';
    if (combined.includes('ibps')) return 'IBPS (Banking)';
    if (combined.includes('sih') || combined.includes('smart india hackathon')) return 'Smart India Hackathon';
    if (combined.includes('scholarship')) return 'National Scholarship Portal';
    if (combined.includes('tcs')) return 'Tata Consultancy Services (TCS)';
    if (combined.includes('infosys')) return 'Infosys';
    if (combined.includes('eapcet') || combined.includes('eamcet')) return 'APSCHE';
    if (combined.includes('gate')) return 'GATE Committee';
    return title.split('-')[0].trim().substring(0, 50);
  }

  // Structured Gemini / LLM Interpretation Fallback (Only when rule-based extraction fails)
  async extractWithLLMFallback(rawSnippet, referenceTitle) {
    if (!this.genAI) return null;

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
Extract structured educational/career opportunity data from this text.
Return ONLY valid JSON (no markdown fences, no extra text):
{
  "title": "Clean opportunity title",
  "organization": "Issuing organization name",
  "category": "Government Exam | Job | Internship | Scholarship | Hackathon",
  "deadline": "YYYY-MM-DD or null if none found",
  "deadline_source_text": "Exact sentence stating the deadline",
  "qualification_req": "Required degrees e.g. B.Tech, Any Graduate",
  "branch_req": "Eligible branches e.g. CSE/IT, Any",
  "graduation_year_req": "Eligible batches e.g. 2026, 2027, Any",
  "location": "Job/exam location e.g. Andhra Pradesh, India",
  "confidence": "high | medium | low"
}

Context title: ${referenceTitle}
Text to extract from:
"${rawSnippet}"
`;
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim().replace(/^```json/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(text);
      return parsed;
    } catch (err) {
      console.warn('⚠️  LLM extraction fallback notice:', err.message);
      return null;
    }
  }

  // Process and extract structured opportunity record from raw item
  async processItem(item, topic = 'General') {
    const textToScan = `${item.title}. ${item.snippet || ''}`;

    // 1. Try Fast Rule-Based Temporal Extraction
    let temporal = this.extractExplicitDeadlines(textToScan);
    let eligibility = this.extractEligibility(textToScan);
    const org = this.inferOrganization(item.title, item.link, item.snippet);

    // 2. If deadline is missing or informal, try LLM fallback
    if (!temporal || !temporal.deadline) {
      const llmResult = await this.extractWithLLMFallback(item.snippet, item.title);
      if (llmResult && llmResult.deadline) {
        temporal = {
          deadline: llmResult.deadline,
          deadline_source_text: llmResult.deadline_source_text || item.snippet.substring(0, 150),
          confidence: llmResult.confidence || 'medium'
        };
        if (llmResult.qualification_req) eligibility.qualification = llmResult.qualification_req;
        if (llmResult.branch_req) eligibility.branch = llmResult.branch_req;
        if (llmResult.location) eligibility.location = llmResult.location;
      }
    }

    if (!temporal || !temporal.deadline) {
      return null; // Skip if no valid future deadline could be identified
    }

    // Determine category
    let category = 'Government Exam';
    const lower = textToScan.toLowerCase();
    if (lower.includes('hackathon') || lower.includes('coding contest')) category = 'Hackathon';
    else if (lower.includes('internship') || lower.includes('intern')) category = 'Internship';
    else if (lower.includes('scholarship') || lower.includes('fellowship') || lower.includes('grant')) category = 'Scholarship';
    else if (lower.includes('job') || lower.includes('recruitment') || lower.includes('developer') || lower.includes('engineer')) category = 'Job';

    return {
      title: item.title.trim().substring(0, 250),
      organization: org,
      category,
      deadline: temporal.deadline,
      deadline_source_text: temporal.deadline_source_text || `Deadline identified as ${temporal.deadline}`,
      qualification_req: eligibility.qualification,
      branch_req: eligibility.branch,
      graduation_year_req: eligibility.graduation_year,
      location: eligibility.location,
      application_url: item.link,
      source_url: item.link,
      trust_level: (item.link.includes('.gov.in') || item.link.includes('.nic.in') || item.link.includes('.ac.in')) ? 'OFFICIAL' : 'VERIFIED_SECONDARY',
      confidence: temporal.confidence || 'medium',
      raw_evidence: item.snippet || ''
    };
  }
}

module.exports = Extractor;
