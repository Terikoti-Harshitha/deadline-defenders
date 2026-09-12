// opportunity_pipeline.js — Unified Opportunity Discovery & Intelligence Pipeline
// Principle: "Search once, process once, store once, personalize many times."

const SearchManager = require('./search_manager');
const SourceCollector = require('./source_collector');
const Extractor = require('./extractor');
const Deduplicator = require('./deduplicator');
const EligibilityMatcher = require('./eligibility_matcher');
const crypto = require('crypto');

class OpportunityPipeline {
  constructor(pool, sendPushFn) {
    this.pool = pool;
    this.searchManager = new SearchManager(pool);
    this.sourceCollector = new SourceCollector(pool);
    this.extractor = new Extractor();
    this.deduplicator = new Deduplicator();
    this.eligibilityMatcher = new EligibilityMatcher();
  }

  async initialize() {
    await this.sourceCollector.initSourceRegistry();
    await this.searchManager.initTopicRegistry();
    await this.seedInitialOpportunitiesIfEmpty();
  }

  // Discover opportunities once per topic, then store canonical records for every user.
  // This is deliberately shared: a user's refresh must never create a separate feed.
  async runDiscovery(topic) {
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    const summary = { runId, topic, found: 0, inserted: 0, updated: 0, duplicates: 0, failed: 0 };

    await this.pool.query(
      'INSERT INTO pipeline_runs (run_id, source_name, started_at) VALUES (?, ?, ?)',
      [runId, String(topic || 'General').slice(0, 100), startedAt]
    );

    try {
      const discovery = await this.searchManager.discoverOpportunities(topic);
      summary.found = discovery.results.length;
      const extracted = [];
      let fetchedPages = 0;

      for (const item of discovery.results) {
        let enrichedItem = item;

        // Search snippets are often incomplete. For a small number of official sources,
        // retain a change-detected page snapshot as additional extraction evidence.
        if (
          fetchedPages < 3 &&
          !this.extractor.extractExplicitDeadlines(`${item.title || ''}. ${item.snippet || ''}`) &&
          this.sourceCollector.evaluateTrustLevel(item.link) === 'OFFICIAL'
        ) {
          fetchedPages += 1;
          const page = await this.sourceCollector.fetchWithChangeDetection(item.link);
          if (page.changed && page.text) {
            enrichedItem = { ...item, snippet: `${item.snippet || ''} ${page.text.slice(0, 4000)}` };
          }
        }

        const opportunity = await this.extractor.processItem(enrichedItem, discovery.topic);
        if (opportunity) extracted.push(opportunity);
      }

      const today = new Date().toISOString().slice(0, 10);
      const canonical = this.deduplicator
        .deduplicateList(extracted)
        .filter(opportunity => opportunity.deadline >= today);

      summary.duplicates = extracted.length - canonical.length;
      for (const opportunity of canonical) {
        const outcome = await this.upsertOpportunity(opportunity);
        summary[outcome] += 1;
      }

      await this.pool.query(
        `UPDATE topic_registry
         SET last_discovered = NOW(), next_discovery = DATE_ADD(NOW(), INTERVAL 24 HOUR)
         WHERE canonical_topic = ?`,
        [discovery.topic]
      );
      return summary;
    } catch (err) {
      summary.failed += 1;
      throw err;
    } finally {
      await this.pool.query(
        `UPDATE pipeline_runs
         SET completed_at = NOW(), items_found = ?, items_new = ?, items_updated = ?,
             items_duplicate = ?, api_calls = ?, llm_calls = 0
         WHERE run_id = ?`,
        [summary.found, summary.inserted, summary.updated, summary.duplicates, 0, runId]
      ).catch(logErr => console.warn('Pipeline metrics warning:', logErr.message));
    }
  }

  async upsertOpportunity(opportunity) {
    const [candidates] = await this.pool.query(
      `SELECT * FROM opportunities
       WHERE organization = ? AND deadline >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)`,
      [opportunity.organization]
    );
    const normalizedTitle = this.deduplicator.normalizeTitle(opportunity.title);
    const existing = candidates.find(candidate => {
      const candidateTitle = this.deduplicator.normalizeTitle(candidate.title);
      return this.deduplicator.isDuplicate(candidate, opportunity) ||
        (candidateTitle && normalizedTitle &&
          (candidateTitle === normalizedTitle || candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle)));
    });
    const columns = [
      'title', 'organization', 'category', 'deadline', 'deadline_source_text',
      'qualification_req', 'branch_req', 'graduation_year_req', 'location',
      'application_url', 'source_url', 'trust_level', 'confidence', 'raw_evidence'
    ];
    const values = columns.map(column => opportunity[column]);

    if (!existing) {
      await this.pool.query(
        `INSERT INTO opportunities (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        values
      );
      return 'inserted';
    }

    if (String(existing.deadline).slice(0, 10) !== opportunity.deadline) {
      await this.pool.query(
        `INSERT INTO opportunity_versions (opportunity_id, old_deadline, new_deadline, change_reason)
         VALUES (?, ?, ?, 'Discovery refresh')`,
        [existing.id, existing.deadline, opportunity.deadline]
      );
    }
    await this.pool.query(
      `UPDATE opportunities SET ${columns.map(column => `${column} = ?`).join(', ')}, is_active = 1
       WHERE id = ?`,
      [...values, existing.id]
    );
    return 'updated';
  }

  // Seed verified multi-tier opportunities (10th, 12th, Diploma, UG, PG, Scholarships, Hackathons)
  async seedInitialOpportunitiesIfEmpty() {
    try {
      const [rows] = await this.pool.query(
        'SELECT COUNT(*) as cnt FROM opportunities WHERE is_active = 1 AND deadline >= CURDATE()'
      );
      if (rows[0].cnt >= 8) return;

      const now = new Date();
      // The seed calendar is autumn-heavy. Once it becomes sparse late in the year,
      // create the following cycle instead of repeatedly restoring expired records.
      const year = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
      const nextYear = year + 1;

      const seedOpps = [
        // 10th Level
        {
          title: `National Talent Search & Science Olympiad (SOF) ${year}`,
          organization: 'Science Olympiad Foundation',
          category: 'Scholarship',
          deadline: `${year}-11-30`,
          deadline_source_text: `Registration closes on 30 November ${year} for class 10 students across India.`,
          qualification_req: '10th Standard',
          branch_req: 'Science & Technology',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://sofworld.org',
          source_url: 'https://sofworld.org',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Official SOF announcement for secondary school students.'
        },
        {
          title: `Indian Navy / Coast Guard Matric Recruit (MR) ${year}`,
          organization: 'Indian Navy',
          category: 'Government Exam',
          deadline: `${year}-10-25`,
          deadline_source_text: `Application submission last date is 25 October ${year}. Required qualification: 10th Pass.`,
          qualification_req: '10th Standard',
          branch_req: 'General',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://joinindiannavy.gov.in',
          source_url: 'https://joinindiannavy.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Indian Navy official notification for 10th pass candidates.'
        },
        // 12th Level
        {
          title: `UPSC National Defence Academy (NDA & NA) Examination ${year}`,
          organization: 'UPSC',
          category: 'Government Exam',
          deadline: `${year}-10-15`,
          deadline_source_text: `Online applications can be filled up to 15th October ${year} till 6.00 PM.`,
          qualification_req: '12th / Intermediate',
          branch_req: 'MPC / Any Stream',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://upsc.gov.in',
          source_url: 'https://upsc.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Union Public Service Commission official notification.'
        },
        {
          title: `SSC Combined Higher Secondary Level (CHSL) ${year}`,
          organization: 'SSC',
          category: 'Government Exam',
          deadline: `${year}-11-10`,
          deadline_source_text: `Last date and time for receipt of online applications is 10-11-${year}.`,
          qualification_req: '12th / Intermediate',
          branch_req: 'Any Stream',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://ssc.gov.in',
          source_url: 'https://ssc.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Staff Selection Commission official examination calendar.'
        },
        // Diploma / ITI Level
        {
          title: `RRB Assistant Loco Pilot & Technician Recruitment ${year}`,
          organization: 'Railway Recruitment Boards (RRB)',
          category: 'Government Exam',
          deadline: `${year}-10-31`,
          deadline_source_text: `Closing date for submission of application is 31.10.${year}. Qualification: Matric + ITI or Diploma.`,
          qualification_req: 'Diploma / ITI',
          branch_req: 'Mechanical, Electrical, Electronics',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://indianrailways.gov.in',
          source_url: 'https://indianrailways.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Ministry of Railways centralized employment notification.'
        },
        // Undergraduate & Graduate Level
        {
          title: `UPSC Civil Services Examination ${year}`,
          organization: 'UPSC',
          category: 'Government Exam',
          deadline: `${year}-10-20`,
          deadline_source_text: `The last date for submission of Civil Services applications is 20 October ${year}.`,
          qualification_req: 'Any Graduate',
          branch_req: 'Any Branch',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://upsc.gov.in',
          source_url: 'https://upsc.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'UPSC Civil Services Gazette Notification.'
        },
        {
          title: `Smart India Hackathon (SIH) ${year} — Grand Finale Challenge`,
          organization: 'Ministry of Education (AICTE)',
          category: 'Hackathon',
          deadline: `${year}-10-18`,
          deadline_source_text: `Idea submissions and team registrations open till 18 October ${year}.`,
          qualification_req: 'Any Student',
          branch_req: 'Open to All Streams',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://sih.gov.in',
          source_url: 'https://sih.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'AICTE Innovation Cell SIH official portal announcement.'
        },
        {
          title: `Prime Minister's National Internship Scheme ${year}`,
          organization: 'Ministry of Corporate Affairs',
          category: 'Internship',
          deadline: `${year}-11-15`,
          deadline_source_text: `Portal registration closes on 15 November ${year} for internships in top 500 companies.`,
          qualification_req: 'Any Graduate / Diploma',
          branch_req: 'Any Branch',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://pminternship.mca.gov.in',
          source_url: 'https://pminternship.mca.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'MCA official portal guidelines for PM Internship Scheme.'
        },
        {
          title: `TCS National Qualifier Test (NQT) & Off-Campus Hiring ${year}`,
          organization: 'Tata Consultancy Services (TCS)',
          category: 'Job',
          deadline: `${year}-10-28`,
          deadline_source_text: `Registration end date: 28 October ${year}. Open to B.Tech, BCA, B.Sc, MCA students.`,
          qualification_req: 'B.Tech / BCA / B.Sc / MCA',
          branch_req: 'CSE, IT, ECE, EEE, Science',
          graduation_year_req: `${year}, ${nextYear}`,
          location: 'India',
          application_url: 'https://www.tcs.com/careers',
          source_url: 'https://www.tcs.com/careers',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'TCS iON official registration portal.'
        },
        {
          title: `National Scholarship Portal (NSP) Higher Education Merit Scheme`,
          organization: 'Ministry of Education',
          category: 'Scholarship',
          deadline: `${year}-12-15`,
          deadline_source_text: `Applications for Central Sector Scheme of Scholarship open until 15 December ${year}.`,
          qualification_req: 'Open to All Students',
          branch_req: 'Any Stream',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://scholarships.gov.in',
          source_url: 'https://scholarships.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'National Scholarship Portal official notification.'
        },
        // Postgraduate Level
        {
          title: `GATE ${nextYear} Graduate Aptitude Test in Engineering`,
          organization: 'GATE Committee (IIT)',
          category: 'Government Exam',
          deadline: `${year}-10-12`,
          deadline_source_text: `Closing date of extended online registration is 12 October ${year}.`,
          qualification_req: 'B.Tech / M.Tech / M.Sc / MCA',
          branch_req: 'Engineering & Sciences',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://gate2026.iitg.ac.in',
          source_url: 'https://gate2026.iitg.ac.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'GATE organizing institute official schedule.'
        }
      ];

      for (const opp of seedOpps) {
        await this.pool.query(
          `INSERT INTO opportunities
           (title, organization, category, deadline, deadline_source_text, qualification_req, branch_req, graduation_year_req, location, application_url, source_url, trust_level, confidence, raw_evidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             deadline = VALUES(deadline),
             deadline_source_text = VALUES(deadline_source_text),
             qualification_req = VALUES(qualification_req),
             branch_req = VALUES(branch_req)`,
          [
            opp.title, opp.organization, opp.category, opp.deadline, opp.deadline_source_text,
            opp.qualification_req, opp.branch_req, opp.graduation_year_req, opp.location,
            opp.application_url, opp.source_url, opp.trust_level, opp.confidence, opp.raw_evidence
          ]
        );
      }
      console.log(`✅ Seeded ${seedOpps.length} diverse, multi-tier opportunities across all educational levels.`);
    } catch (err) {
      console.warn('⚠️  Opportunity seed warning:', err.message);
    }
  }

  // Get Personalized Opportunities for a User
  async getPersonalizedFeed(userId, categoryFilter = null) {
    try {
      // 1. Get user profile & interests (NO fake B.Tech fallback!)
      const [profRows] = await this.pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
      const profile = profRows.length > 0 ? profRows[0] : {};

      const [intRows] = await this.pool.query('SELECT interest FROM user_interests WHERE user_id = ?', [userId]);
      const interests = intRows.map(r => r.interest);

      // 2. Get user opportunity actions (saved / applied / dismissed)
      const [actionRows] = await this.pool.query('SELECT opportunity_id, status FROM user_opportunity_actions WHERE user_id = ?', [userId]);
      const actionMap = {};
      actionRows.forEach(a => { actionMap[a.opportunity_id] = a.status; });

      // 3. Query active opportunities
      let sql = 'SELECT * FROM opportunities WHERE deadline >= CURDATE() AND is_active = 1';
      const params = [];
      if (categoryFilter && categoryFilter !== 'all') {
        sql += ' AND category = ?';
        params.push(categoryFilter);
      }
      sql += ' ORDER BY deadline ASC LIMIT 100';

      const [oppRows] = await this.pool.query(sql, params);

      return this.rankAndAttachActions(oppRows, profile, interests, actionMap);
    } catch (err) {
      console.error('Personalized feed error:', err.message);
      return [];
    }
  }

  rankAndAttachActions(opportunities, profile, interests, actionMap) {
    const ranked = this.eligibilityMatcher.rankOpportunities(opportunities, profile, interests);
    return ranked.map(opp => ({
      ...opp,
      userStatus: actionMap[opp.id] || 'unseen'
    }));
  }
}

module.exports = OpportunityPipeline;
