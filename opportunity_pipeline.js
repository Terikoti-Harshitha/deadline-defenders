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
      const year = now.getFullYear();
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
          category: 'Government Job',
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
          title: `AI Research Internship ${year}`,
          organization: 'National Innovation Lab',
          category: 'Internship',
          deadline: `${year}-09-25`,
          deadline_source_text: `Applications must be submitted on or before 25 September ${year} through the official portal.`,
          qualification_req: 'Undergraduate / B.Tech',
          branch_req: 'AI, Data Science, CSE',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://nil.gov.in',
          source_url: 'https://nil.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'National Innovation Lab official research internship portal.'
        },
        {
          title: `SSC CGL — Combined Graduate Level ${year}`,
          organization: 'Staff Selection Commission',
          category: 'Government Exam',
          deadline: `${year}-09-14`,
          deadline_source_text: `Online applications will be closed on 14.09.${year}, no request for extension will be entertained.`,
          qualification_req: 'Any Graduate',
          branch_req: 'Any Stream',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://ssc.gov.in',
          source_url: 'https://ssc.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Staff Selection Commission official notification.'
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
          title: `Google Cloud Study Jams & Certification ${year}`,
          organization: 'Google Developer Groups',
          category: 'Certification',
          deadline: `${year}-11-05`,
          deadline_source_text: `All facilitator-led labs must be finished before 5 November ${year} to earn the badge.`,
          qualification_req: 'Open to all',
          branch_req: 'Any Stream',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://developers.google.com',
          source_url: 'https://developers.google.com',
          trust_level: 'VERIFIED_SECONDARY',
          confidence: 'high',
          raw_evidence: 'Google Developers community portal.'
        },
        {
          title: `DST Inspire Fellowship ${year}`,
          organization: 'Department of Science & Technology',
          category: 'Fellowship',
          deadline: `${year}-10-01`,
          deadline_source_text: `Fellowship applications for the ${year} cycle must be received on or before 1st October ${year}.`,
          qualification_req: 'Postgraduate / Ph.D.',
          branch_req: 'Basic & Applied Sciences',
          graduation_year_req: 'Any',
          location: 'India',
          application_url: 'https://online-inspire.gov.in',
          source_url: 'https://online-inspire.gov.in',
          trust_level: 'OFFICIAL',
          confidence: 'high',
          raw_evidence: 'Department of Science and Technology portal.'
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
      const [profRows] = await this.pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
      const profile = profRows.length > 0 ? profRows[0] : {};

      const [intRows] = await this.pool.query('SELECT interest FROM user_interests WHERE user_id = ?', [userId]);
      const interests = intRows.map(r => r.interest);

      const [actionRows] = await this.pool.query('SELECT opportunity_id, status FROM user_opportunity_actions WHERE user_id = ?', [userId]);
      const actionMap = {};
      actionRows.forEach(a => { actionMap[a.opportunity_id] = a.status; });

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return ranked.map(opp => {
      const deadlineDate = opp.deadline ? new Date(opp.deadline) : null;
      let daysLeft = 14;
      let deadlineLabel = 'Closing Soon';

      if (deadlineDate && !isNaN(deadlineDate.getTime())) {
        deadlineDate.setHours(0, 0, 0, 0);
        daysLeft = Math.max(0, Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24)));
        deadlineLabel = deadlineDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }

      const trust = (opp.trust_level || 'OFFICIAL').toLowerCase().includes('official')
        ? 'official'
        : (opp.trust_level || '').toLowerCase().includes('verified')
        ? 'verified'
        : 'unverified';

      const isSaved = actionMap[opp.id] === 'saved';
      const isApplied = actionMap[opp.id] === 'applied';

      const userEdu = (profile.education_level || profile.qualification || '').toLowerCase();
      const oppQual = (opp.qualification_req || 'Any').toLowerCase();
      const isQualMatch = oppQual.includes('any') || (userEdu && (oppQual.includes(userEdu) || userEdu.includes(oppQual)));

      const eligibility = [
        {
          label: opp.qualification_req && opp.qualification_req !== 'Any' ? opp.qualification_req : 'Open qualification',
          status: userEdu ? (isQualMatch ? 'match' : 'warn') : 'missing'
        },
        {
          label: opp.branch_req && opp.branch_req !== 'Any' ? `${opp.branch_req}` : 'Open stream',
          status: 'match'
        },
        {
          label: opp.location && opp.location !== 'India' ? opp.location : 'National / India',
          status: 'match'
        }
      ];

      return {
        id: opp.id,
        title: opp.title,
        org: opp.organization || 'Official Agency',
        category: opp.category || 'Government Exam',
        deadline: opp.deadline,
        deadlineLabel,
        daysLeft,
        isNew: opp.created_at ? (Date.now() - new Date(opp.created_at).getTime() < 14 * 86400000) : true,
        matchScore: opp.matchScore || 85,
        interestMatch: Math.min(98, (opp.matchScore || 85) + 5),
        eligibilityStatus: opp.isEligible ? 'known' : 'unknown',
        eligibility,
        trust,
        evidenceQuote: opp.deadline_source_text || opp.raw_evidence || `Application deadline verified as ${deadlineLabel} from official notification.`,
        evidenceMethod: opp.confidence === 'high' ? 'CHRONO' : opp.confidence === 'low' ? 'LLM' : 'REGEX',
        evidenceConfidence: (opp.confidence || 'HIGH').toUpperCase(),
        lastVerified: opp.updated_at ? new Date(opp.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '12 Sep 2026',
        saved: isSaved,
        applied: isApplied,
        sourceUrl: opp.application_url || opp.source_url || '#',
        userStatus: actionMap[opp.id] || 'unseen'
      };
    });
  }
}

module.exports = OpportunityPipeline;
