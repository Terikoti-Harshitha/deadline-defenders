// eligibility_matcher.js — Explainable Student Eligibility & Personalization Engine
// Architecture: Multi-Attribute Matching (Qualification, Branch, Year, Location, Interests)
// Principle: "Match locally, explain transparently."

class EligibilityMatcher {
  // Compute match score and explainable reasons between an opportunity and student profile
  evaluateEligibility(opportunity, profile, userInterests = []) {
    let score = 50; // baseline score for any valid opportunity
    const reasons = [];
    const mismatches = [];

    const oppQual = (opportunity.qualification_req || 'Any').toLowerCase();
    const userQual = (profile?.qualification || 'B.Tech').toLowerCase();

    const oppBranch = (opportunity.branch_req || 'Any').toLowerCase();
    const userBranch = (profile?.branch || 'Computer Science').toLowerCase();

    const oppYear = (opportunity.graduation_year_req || 'Any').toLowerCase();
    const userYear = String(profile?.graduation_year || '2026');

    const oppLoc = (opportunity.location || 'India').toLowerCase();
    const userLoc = (profile?.state_location || 'Andhra Pradesh').toLowerCase();

    // 1. Qualification Matching
    if (oppQual.includes('any') || oppQual.includes('graduate')) {
      score += 15;
      reasons.push('✓ Open to All Graduates');
    } else if (
      (userQual.includes('b.tech') && (oppQual.includes('b.tech') || oppQual.includes('btech') || oppQual.includes('b.e'))) ||
      (userQual.includes('diploma') && oppQual.includes('diploma')) ||
      (userQual.includes('12th') && (oppQual.includes('12th') || oppQual.includes('intermediate')))
    ) {
      score += 20;
      reasons.push(`✓ Matches Qualification (${profile.qualification})`);
    } else {
      score -= 10;
      mismatches.push(`Required: ${opportunity.qualification_req}`);
    }

    // 2. Branch Matching
    if (oppBranch.includes('any') || oppBranch.includes('all')) {
      score += 10;
      reasons.push('✓ Open to All Branches');
    } else if (
      (userBranch.includes('computer') || userBranch.includes('cse') || userBranch.includes('it')) &&
      (oppBranch.includes('cse') || oppBranch.includes('it') || oppBranch.includes('computer'))
    ) {
      score += 15;
      reasons.push(`✓ Matches Branch (${profile.branch})`);
    } else if (
      (userBranch.includes('electronics') || userBranch.includes('ece')) &&
      (oppBranch.includes('ece') || oppBranch.includes('electronics'))
    ) {
      score += 15;
      reasons.push(`✓ Matches Branch (${profile.branch})`);
    }

    // 3. Batch / Graduation Year Matching
    if (oppYear.includes('any') || oppYear.includes(userYear)) {
      score += 10;
      reasons.push(`✓ Eligible Batch (${userYear})`);
    }

    // 4. Location Matching
    if (oppLoc.includes('india') || oppLoc.includes('all india') || oppLoc.includes(userLoc)) {
      score += 10;
      reasons.push(`✓ Location Applicable (${opportunity.location})`);
    }

    // 5. Interest Alignment
    const titleLower = opportunity.title.toLowerCase();
    const orgLower = opportunity.organization.toLowerCase();
    const isInterestMatch = userInterests.some(i => {
      const iLow = i.toLowerCase();
      return titleLower.includes(iLow) || orgLower.includes(iLow) || (opportunity.category && opportunity.category.toLowerCase().includes(iLow));
    });

    if (isInterestMatch) {
      score += 15;
      reasons.push('⭐ Aligns with Your Chosen Interests');
    }

    // Normalize final score between 10% and 99%
    const finalScore = Math.min(99, Math.max(15, score));

    return {
      matchScore: finalScore,
      isEligible: finalScore >= 60,
      reasons,
      mismatches,
      summaryText: reasons.slice(0, 3).join(' · ')
    };
  }

  // Personalize and rank opportunities for a specific user
  rankOpportunities(opportunities, profile, userInterests = []) {
    return opportunities.map(opp => {
      const evaluation = this.evaluateEligibility(opp, profile, userInterests);
      return {
        ...opp,
        matchScore: evaluation.matchScore,
        isEligible: evaluation.isEligible,
        matchReasons: evaluation.reasons,
        matchSummary: evaluation.summaryText
      };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }
}

module.exports = EligibilityMatcher;
