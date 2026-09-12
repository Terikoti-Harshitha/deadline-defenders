// source_collector.js — Incremental Source Ingestion & Change Detection Module
// Architecture: Content Hashing, ETag, Last-Modified & Source Registry
// Inspired by: Lin et al. (Cost-effective Web Event Mining) & Foley et al.

const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

const SEED_SOURCES = [
  {
    organization: 'UPSC',
    source_url: 'https://upsc.gov.in',
    category: 'Government Exam',
    source_type: 'Official Government',
    acquisition_method: 'Direct HTML + Search',
    trust_level: 'OFFICIAL',
    check_frequency: 'DAILY'
  },
  {
    organization: 'SSC',
    source_url: 'https://ssc.gov.in',
    category: 'Government Exam',
    source_type: 'Official Government',
    acquisition_method: 'Direct HTML + Search',
    trust_level: 'OFFICIAL',
    check_frequency: 'DAILY'
  },
  {
    organization: 'Railway Recruitment Boards (RRB)',
    source_url: 'https://indianrailways.gov.in',
    category: 'Government Exam',
    source_type: 'Official Government',
    acquisition_method: 'Search Discovery',
    trust_level: 'OFFICIAL',
    check_frequency: 'DAILY'
  },
  {
    organization: 'National Testing Agency (NTA)',
    source_url: 'https://nta.ac.in',
    category: 'Government Exam',
    source_type: 'Official Government',
    acquisition_method: 'Direct HTML + Search',
    trust_level: 'OFFICIAL',
    check_frequency: 'DAILY'
  },
  {
    organization: 'National Scholarship Portal (NSP)',
    source_url: 'https://scholarships.gov.in',
    category: 'Scholarship',
    source_type: 'National Portal',
    acquisition_method: 'Direct HTML + Search',
    trust_level: 'OFFICIAL',
    check_frequency: 'WEEKLY'
  },
  {
    organization: 'Smart India Hackathon (SIH)',
    source_url: 'https://sih.gov.in',
    category: 'Hackathon',
    source_type: 'Official Government (MHRD)',
    acquisition_method: 'Direct HTML + Search',
    trust_level: 'OFFICIAL',
    check_frequency: 'WEEKLY'
  },
  {
    organization: 'PM Internship Scheme',
    source_url: 'https://pminternship.mca.gov.in',
    category: 'Internship',
    source_type: 'Official Government',
    acquisition_method: 'Direct HTML + Search',
    trust_level: 'OFFICIAL',
    check_frequency: 'WEEKLY'
  },
  {
    organization: 'TCS Careers',
    source_url: 'https://www.tcs.com/careers',
    category: 'Job',
    source_type: 'Corporate Career Portal',
    acquisition_method: 'Search Discovery',
    trust_level: 'OFFICIAL',
    check_frequency: 'WEEKLY'
  },
  {
    organization: 'Infosys Careers',
    source_url: 'https://www.infosys.com/careers',
    category: 'Job',
    source_type: 'Corporate Career Portal',
    acquisition_method: 'Search Discovery',
    trust_level: 'OFFICIAL',
    check_frequency: 'WEEKLY'
  }
];

class SourceCollector {
  constructor(pool) {
    this.pool = pool;
  }

  // Initialize and seed verified source registry
  async initSourceRegistry() {
    try {
      for (const src of SEED_SOURCES) {
        await this.pool.query(
          `INSERT INTO sources (organization, source_url, category, source_type, acquisition_method, trust_level, check_frequency)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE category=VALUES(category), trust_level=VALUES(trust_level)`,
          [src.organization, src.source_url, src.category, src.source_type, src.acquisition_method, src.trust_level, src.check_frequency]
        );
      }
      console.log('✅ Source Registry seeded with verified official sources.');
    } catch (err) {
      console.warn('⚠️  Source Registry init warning:', err.message);
    }
  }

  // Compute SHA-256 content hash
  calculateHash(content) {
    return crypto.createHash('sha256').update(content || '').digest('hex');
  }

  // Determine trust level based on domain extension
  evaluateTrustLevel(url) {
    if (!url) return 'UNVERIFIED';
    const lower = url.toLowerCase();
    if (lower.includes('.gov.in') || lower.includes('.nic.in') || lower.includes('.ac.in') || lower.includes('.edu.in')) {
      return 'OFFICIAL';
    }
    if (lower.includes('tcs.com') || lower.includes('infosys.com') || lower.includes('wipro.com') || lower.includes('ibm.com')) {
      return 'OFFICIAL';
    }
    if (lower.includes('unstop.com') || lower.includes('internshala.com') || lower.includes('freejobalert.com') || lower.includes('sarkariresult.com')) {
      return 'VERIFIED_SECONDARY';
    }
    return 'UNVERIFIED';
  }

  // Fetch page with ETag / Last-Modified change detection
  async fetchWithChangeDetection(url, sourceId = null) {
    try {
      // 1. Check existing document record
      const [docs] = await this.pool.query(
        'SELECT content_hash, etag, last_modified FROM source_documents WHERE url = ? LIMIT 1',
        [url]
      );

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      };

      if (docs.length > 0) {
        if (docs[0].etag) headers['If-None-Match'] = docs[0].etag;
        if (docs[0].last_modified) headers['If-Modified-Since'] = docs[0].last_modified;
      }

      const res = await axios.get(url, { headers, timeout: 10000, validateStatus: s => s < 400 || s === 304 });

      // If HTTP 304 Not Modified, page has not changed!
      if (res.status === 304) {
        console.log(`⚡ [INCREMENTAL] HTTP 304 Not Modified: ${url}`);
        return { changed: false, url };
      }

      const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      const newHash = this.calculateHash(html);

      if (docs.length > 0 && docs[0].content_hash === newHash) {
        console.log(`⚡ [INCREMENTAL] SHA-256 Hash unchanged for: ${url}`);
        return { changed: false, url };
      }

      // Extract clean text
      const $ = cheerio.load(html);
      $('script, style, noscript, nav, footer, header').remove();
      const cleanText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 15000);

      // Save document state
      await this.pool.query(
        `INSERT INTO source_documents (source_id, url, content_hash, etag, last_modified, raw_text, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE content_hash=VALUES(content_hash), etag=VALUES(etag), last_modified=VALUES(last_modified), raw_text=VALUES(raw_text), fetched_at=NOW()`,
        [sourceId, url, newHash, res.headers['etag'] || null, res.headers['last-modified'] || null, cleanText]
      );

      return {
        changed: true,
        url,
        text: cleanText,
        title: $('title').text().trim(),
        etag: res.headers['etag'],
        lastModified: res.headers['last-modified']
      };
    } catch (err) {
      console.warn(`Source fetch warning (${url}):`, err.message);
      return { changed: false, url, error: err.message };
    }
  }
}

module.exports = SourceCollector;
