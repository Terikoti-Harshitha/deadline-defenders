// opportunity_pipeline.js — Unified Opportunity Discovery & Intelligence Pipeline
// Principle: "Search once, process once, store once, personalize many times."

const SearchManager = require('./search_manager');
const SourceCollector = require('./source_collector');
const Extractor = require('./extractor');
const Deduplicator = require('./deduplicator');
const EligibilityMatcher = require('./eligibility_matcher');

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
  }

  // Master discovery pipeline for a topic or keyword
  async runDiscovery(topicQuery) {
    const runId = `RUN_${Date.now()}`;
    const startTime = new Date();
    let itemsFound = 0, itemsNew = 0, itemsUpdated = 0, itemsDuplicate = 0;

    console.log(`\n🚀 [PIPELINE RUN: ${runId}] Starting opportunity discovery for: "${topicQuery}"`);

    try {
      // 1. Discovery via Shared Search Manager
      const { fromCache, results, topic } = await this.searchManager.discoverOpportunities(topicQuery);
      itemsFound = results.length;

      // 2. Extract structured opportunity records
      const rawExtracted = [];
      for (const item of results) {
        const extracted = await this.extractor.processItem(item, topic);
        if (extracted && extracted.deadline) {
          rawExtracted.push(extracted);
        }
      }

      // 3. Deduplicate and merge cross-posted records
      const canonicalOpps = this.deduplicator.deduplicateList(rawExtracted);
      itemsDuplicate = rawExtracted.length - canonicalOpps.length;

      // 4. Save into Master Opportunities Store
      for (const opp of canonicalOpps) {
        try {
          const [res] = await this.pool.query(
            `INSERT INTO opportunities
             (title, organization, category, deadline, deadline_source_text, qualification_req, branch_req, graduation_year_req, location, application_url, source_url, trust_level, confidence, raw_evidence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               deadline = VALUES(deadline),
               deadline_source_text = VALUES(deadline_source_text),
               qualification_req = VALUES(qualification_req),
               branch_req = VALUES(branch_req),
               updated_at = NOW()`,
            [
              opp.title, opp.organization, opp.category, opp.deadline, opp.deadline_source_text,
              opp.qualification_req, opp.branch_req, opp.graduation_year_req, opp.location,
              opp.application_url, opp.source_url, opp.trust_level, opp.confidence, opp.raw_evidence
            ]
          );

          if (res.affectedRows === 1) itemsNew++;
          else if (res.affectedRows === 2) itemsUpdated++;
        } catch (dbErr) {
          console.warn('Opportunity insert notice:', dbErr.message);
        }
      }

      // 5. Log Pipeline Run Performance Metric (Academic Evaluation)
      await this.pool.query(
        `INSERT INTO pipeline_runs
         (run_id, source_name, started_at, completed_at, items_found, items_new, items_updated, items_duplicate, api_calls, llm_calls)
         VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [runId, topic, startTime, itemsFound, itemsNew, itemsUpdated, itemsDuplicate, fromCache ? 0 : 2, 0]
      );

      console.log(`✅ [PIPELINE RUN: ${runId}] Completed: ${itemsNew} new, ${itemsUpdated} updated, ${itemsDuplicate} duplicates merged (Cache: ${fromCache ? 'HIT' : 'MISS'})\n`);

      return {
        runId,
        topic,
        fromCache,
        itemsFound,
        itemsNew,
        itemsUpdated,
        itemsDuplicate,
        opportunities: canonicalOpps
      };
    } catch (err) {
      console.error(`❌ [PIPELINE ERROR: ${runId}]`, err.message);
      return { runId, error: err.message, opportunities: [] };
    }
  }

  // Get Personalized Opportunities for a User
  async getPersonalizedFeed(userId, categoryFilter = null) {
    try {
      // 1. Get user profile & interests
      const [profRows] = await this.pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [userId]);
      const profile = profRows.length > 0 ? profRows[0] : { qualification: 'B.Tech', branch: 'Computer Science', graduation_year: 2026, state_location: 'Andhra Pradesh' };

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

      // If opportunities table is sparse, run seed discovery
      if (oppRows.length < 5 && interests.length > 0) {
        for (const i of interests.slice(0, 2)) {
          await this.runDiscovery(i);
        }
        const [refreshed] = await this.pool.query(sql, params);
        return this.rankAndAttachActions(refreshed, profile, interests, actionMap);
      }

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
