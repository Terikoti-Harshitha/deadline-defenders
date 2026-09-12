// eligibility_matcher.js — Explainable Multi-Profile Eligibility & Personalization Engine
// Philosophy: "Minimum info -> useful recommendations. More info -> accurate personalization."
// Golden Rule: "Missing information must never be assumed as eligibility."

class EligibilityMatcher {
  // Compute match score, matching mode, and explainable reasons for any profile (10th, 12th, Diploma, UG, PG, or Interest-only)
  evaluateEligibility(opportunity, profile, userInterests = []) {
    let score = 50; // baseline score
    const verifiedReasons = [];
    const unverifiedNotices = [];
    const mismatches = [];

    const oppQual = (opportunity.qualification_req || 'Any').toLowerCase();
    const oppBranch = (opportunity.branch_req || 'Any').toLowerCase();
    const oppYear = (opportunity.graduation_year_req || 'Any').toLowerCase();
    const oppLoc = (opportunity.location || 'India').toLowerCase();
    const oppTitle = (opportunity.title || '').toLowerCase();
    const oppOrg = (opportunity.organization || '').toLowerCase();
    const oppCat = (opportunity.category || '').toLowerCase();

    // Check what profile information is actually provided by user (NULL = skipped)
    const hasEducation = Boolean(profile && (profile.education_level || profile.qualification));
    const hasLocation = Boolean(profile && (profile.state_location || profile.city));
    const hasSkills = Boolean(profile && profile.skills);
    const hasInterests = Array.isArray(userInterests) && userInterests.length > 0;

    const userEduLevel = (profile?.education_level || '').toLowerCase();
    const userQual = (profile?.qualification || '').toLowerCase();
    const userBranch = (profile?.branch || '').toLowerCase();
    const userYear = profile?.graduation_year ? String(profile.graduation_year) : null;
    const userLoc = (profile?.state_location || '').toLowerCase();
    let educationMatched = !hasEducation;
    let hasHardEducationMismatch = false;
    const isOpenToAllQualifications = /\b(open to all|open to any|all students|all applicants|any student|any applicant|any qualification)\b/.test(oppQual);

    // ── 1. INTEREST ALIGNMENT (Primary for all users) ─────────────
    let isInterestMatch = false;
    let matchedInterestName = '';

    if (hasInterests) {
      for (const i of userInterests) {
        const iLow = i.toLowerCase().trim();
        if (oppTitle.includes(iLow) || oppOrg.includes(iLow) || oppCat.includes(iLow) || oppBranch.includes(iLow)) {
          isInterestMatch = true;
          matchedInterestName = i;
          break;
        }
      }
    }

    if (isInterestMatch) {
      score += 25;
      verifiedReasons.push(`⭐ Aligns with Tracked Interest (${matchedInterestName})`);
    } else if (hasInterests) {
      // General match in opportunity pool
      score += 5;
    }

    // ── 2. EDUCATION MATCHING (Progressive & Inclusive) ────────────
    if (!hasEducation) {
      if (oppQual.includes('any') || oppQual.includes('open') || oppCat.includes('hackathon') || oppCat.includes('competition')) {
        score += 15;
        verifiedReasons.push('✓ Open to All Educational Backgrounds');
      } else {
        unverifiedNotices.push(`⚠️ Education not provided (Requires: ${opportunity.qualification_req || 'Specific qualification'})`);
      }
    } else {
      // User has provided education info (10th, 12th, Diploma, ITI, UG, PG, etc.)
      const is10th = userEduLevel.includes('10th') || userQual.includes('10th') || userQual.includes('matric');
      const is12th = userEduLevel.includes('12th') || userQual.includes('12th') || userQual.includes('inter') || userQual.includes('mpc') || userQual.includes('bipc');
      const isDiploma = userEduLevel.includes('diploma') || userEduLevel.includes('iti') || userQual.includes('diploma') || userQual.includes('iti');
      const isUG = userEduLevel.includes('undergraduate') || userQual.includes('b.tech') || userQual.includes('btech') || userQual.includes('b.sc') || userQual.includes('b.com') || userQual.includes('bca') || userQual.includes('bba') || userQual.includes('degree');
      const isPG = userEduLevel.includes('postgraduate') || userQual.includes('m.tech') || userQual.includes('mca') || userQual.includes('mba') || userQual.includes('m.sc');

      // "Any Graduate" is not the same as "open to all students".
      if (isOpenToAllQualifications) {
        score += 20;
        educationMatched = true;
        verifiedReasons.push('✓ Open to All Students & Applicants');
      } else if (is10th && (oppQual.includes('10th') || oppQual.includes('matric') || oppQual.includes('secondary') || oppTitle.includes('olympiad') || oppTitle.includes('scholarship'))) {
        score += 25;
        educationMatched = true;
        verifiedReasons.push(`✓ Matches 10th Standard Level`);
      } else if (is12th && (oppQual.includes('12th') || oppQual.includes('intermediate') || oppQual.includes('higher secondary') || oppQual.includes('10+2'))) {
        score += 25;
        educationMatched = true;
        verifiedReasons.push(`✓ Matches 12th / Intermediate Level`);
      } else if (isDiploma && (oppQual.includes('diploma') || oppQual.includes('iti') || oppQual.includes('polytechnic'))) {
        score += 25;
        educationMatched = true;
        verifiedReasons.push(`✓ Matches Diploma / ITI Qualification`);
      } else if (isUG && (oppQual.includes('graduate') || oppQual.includes('degree') || oppQual.includes('b.tech') || oppQual.includes('b.e') || oppQual.includes('b.sc') || oppQual.includes('b.com') || oppQual.includes('bca') || oppQual.includes('bba') || oppQual.includes('ug'))) {
        score += 25;
        educationMatched = true;
        verifiedReasons.push(`✓ Matches Degree / Undergraduate Level (${profile.qualification || profile.education_level})`);
      } else if (isPG && (oppQual.includes('postgraduate') || oppQual.includes('pg') || oppQual.includes('masters') || oppQual.includes('m.tech') || oppQual.includes('mca') || oppQual.includes('mba') || oppQual.includes('m.sc'))) {
        score += 25;
        educationMatched = true;
        verifiedReasons.push(`✓ Matches Postgraduate Level (${profile.qualification || profile.education_level})`);
      } else if (oppQual.includes(userQual) || (userQual && userQual.includes(oppQual))) {
        score += 20;
        educationMatched = true;
        verifiedReasons.push(`✓ Matches Qualification (${profile.qualification})`);
      } else {
        score -= 10;
        hasHardEducationMismatch = true;
        mismatches.push(`Required: ${opportunity.qualification_req}`);
      }

      // Branch / Specialization / Trade Matching
      if (userBranch) {
        if (oppBranch.includes('any') || oppBranch.includes('all')) {
          score += 10;
          verifiedReasons.push('✓ Open to All Streams / Branches');
        } else if (oppBranch.includes(userBranch) || userBranch.includes(oppBranch)) {
          score += 15;
          verifiedReasons.push(`✓ Matches Stream / Specialization (${profile.branch})`);
        }
      }
    }

    // ── 3. BATCH & GRADUATION YEAR MATCHING ──────────────────────
    if (educationMatched && userYear && userYear !== 'null') {
      if (oppYear.includes('any') || oppYear.includes(userYear)) {
        score += 10;
        verifiedReasons.push(`✓ Eligible Batch (${userYear})`);
      }
    }

    // ── 4. LOCATION MATCHING ─────────────────────────────────────
    if (!hasLocation) {
      if (oppLoc.includes('online') || oppLoc.includes('remote') || oppLoc.includes('india') || oppLoc.includes('national')) {
        score += 10;
        verifiedReasons.push('✓ Online / National Opportunity');
      } else {
        unverifiedNotices.push(`⚠️ Location not provided (Notice: ${opportunity.location || 'Specific State'})`);
      }
    } else {
      if (oppLoc.includes('india') || oppLoc.includes('all india') || oppLoc.includes('remote') || oppLoc.includes('online') || (userLoc && oppLoc.includes(userLoc))) {
        score += 15;
        verifiedReasons.push(`✓ Location Applicable (${opportunity.location || 'India'})`);
      } else {
        score -= 5;
        mismatches.push(`Location: ${opportunity.location}`);
      }
    }

    // ── 5. SKILLS MATCHING ───────────────────────────────────────
    if (hasSkills) {
      try {
        const skillsList = Array.isArray(profile.skills) ? profile.skills : JSON.parse(profile.skills || '[]');
        for (const sk of skillsList) {
          if (oppTitle.includes(sk.toLowerCase()) || oppCat.includes(sk.toLowerCase())) {
            score += 10;
            verifiedReasons.push(`✓ Matches Skill (${sk})`);
            break;
          }
        }
      } catch (_) {}
    }

    // ── 6. DETERMINE MATCHING MODE & CONFIDENCE ─────────────────
    let matchType = 'INTEREST_DISCOVERY';
    let matchConfidence = 'DISCOVERY';

    if (hasEducation && hasLocation && hasInterests && !hasHardEducationMismatch) {
      matchType = 'FULL_MATCH';
      matchConfidence = 'HIGH';
    } else if (hasEducation || hasLocation) {
      matchType = 'PARTIAL_MATCH';
      matchConfidence = 'MEDIUM';
    } else {
      matchType = 'INTEREST_DISCOVERY';
      matchConfidence = 'DISCOVERY';
    }

    // Normalize final score
    const finalScore = Math.min(99, Math.max(15, score));

    return {
      matchScore: finalScore,
      matchType,
      matchConfidence,
      isEligible: !hasHardEducationMismatch && finalScore >= 60,
      reasons: verifiedReasons,
      unverifiedNotices,
      mismatches,
      hasHardEducationMismatch,
      summaryText: verifiedReasons.slice(0, 3).join(' · ') || (unverifiedNotices[0] || 'Interest-based recommendation')
    };
  }

  // Personalize and rank opportunities for a specific user
  rankOpportunities(opportunities, profile, userInterests = []) {
    return opportunities.map(opp => {
      const evaluation = this.evaluateEligibility(opp, profile, userInterests);
      return {
        ...opp,
        matchScore: evaluation.matchScore,
        matchType: evaluation.matchType,
        matchConfidence: evaluation.matchConfidence,
        isEligible: evaluation.isEligible,
        matchReasons: evaluation.reasons,
        unverifiedNotices: evaluation.unverifiedNotices,
        matchSummary: evaluation.summaryText,
        hasHardEducationMismatch: evaluation.hasHardEducationMismatch
      };
    }).filter(opp => !opp.hasHardEducationMismatch)
      .sort((a, b) => b.matchScore - a.matchScore);
  }
}

module.exports = EligibilityMatcher;
