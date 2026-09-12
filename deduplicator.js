// deduplicator.js — Entity Resolution & Opportunity Deduplication Engine
// Architecture: Organization Normalization, Title Similarity & Source Trust Prioritization
// Principle: "Merge duplicates, prioritize official government & primary sources."

class Deduplicator {
  // Normalize organization names into canonical entity names
  normalizeOrg(org) {
    if (!org) return 'General';
    const clean = org.toLowerCase().replace(/[\.\,\-]/g, '').trim();

    if (clean.includes('union public service') || clean === 'upsc') return 'UPSC';
    if (clean.includes('staff selection') || clean === 'ssc') return 'SSC';
    if (clean.includes('railway') || clean === 'rrb') return 'RRB (Railways)';
    if (clean.includes('national testing agency') || clean === 'nta') return 'NTA';
    if (clean.includes('banking personnel') || clean === 'ibps') return 'IBPS';
    if (clean.includes('smart india') || clean === 'sih') return 'Smart India Hackathon';
    if (clean.includes('scholarship') || clean === 'nsp') return 'National Scholarship Portal';
    if (clean.includes('tata consultancy') || clean === 'tcs') return 'TCS';
    if (clean.includes('infosys')) return 'Infosys';
    if (clean.includes('andhra pradesh') && clean.includes('eapcet')) return 'APSCHE (EAPCET)';
    return org.trim();
  }

  // Normalize opportunity title for semantic comparison
  normalizeTitle(title) {
    if (!title) return '';
    return title.toLowerCase()
      .replace(/[^\w\s]/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/202[4-9]/g, '')
      .replace(/(notification|recruitment|apply online|exam date|application form|admit card)/gi, '')
      .trim();
  }

  // Check if two opportunity records represent the exact same opportunity
  isDuplicate(a, b) {
    // 1. Same exact application link
    if (a.application_url && b.application_url && a.application_url.toLowerCase() === b.application_url.toLowerCase()) {
      return true;
    }

    // 2. Same normalized organization + same deadline + similar normalized title
    const orgA = this.normalizeOrg(a.organization);
    const orgB = this.normalizeOrg(b.organization);

    if (orgA === orgB && a.deadline === b.deadline) {
      const titleA = this.normalizeTitle(a.title);
      const titleB = this.normalizeTitle(b.title);

      if (titleA === titleB || titleA.includes(titleB) || titleB.includes(titleA)) {
        return true;
      }
    }

    return false;
  }

  // Deduplicate an array of extracted opportunities, giving priority to OFFICIAL sources
  deduplicateList(opportunities) {
    const canonicalList = [];

    for (const opp of opportunities) {
      if (!opp.deadline) continue;

      const existingIndex = canonicalList.findIndex(item => this.isDuplicate(item, opp));

      if (existingIndex === -1) {
        canonicalList.push({
          ...opp,
          organization: this.normalizeOrg(opp.organization)
        });
      } else {
        const existing = canonicalList[existingIndex];
        // If the new one has a higher trust level (e.g. OFFICIAL over SECONDARY), upgrade it!
        if (opp.trust_level === 'OFFICIAL' && existing.trust_level !== 'OFFICIAL') {
          canonicalList[existingIndex] = {
            ...opp,
            organization: this.normalizeOrg(opp.organization)
          };
        }
      }
    }

    return canonicalList;
  }
}

module.exports = Deduplicator;
