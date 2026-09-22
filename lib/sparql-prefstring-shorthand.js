const DEFAULT_PREFSTRING_LANGUAGES = [
	"en", 
	"nl", 
	""
];
const DEFAULT_PREFSTRING_PREDICATES = [
	"<http://purl.org/dc/terms/title>",                   // dct:title
	"<http://www.w3.org/2004/02/skos/core#prefLabel>",    // skos:prefLabel
	"<http://www.w3.org/2000/01/rdf-schema#label>",       // rdfs:label
	"<http://www.w3.org/1999/02/22-rdf-syntax-ns#value>", // rdf:value
	"lfn:localname"
];
const AUTO_LANGUAGE_NAME = "[AUTO_LANGUAGE]";
const PREFSTRING_VAR_PREFIX = "prefString";
let isAutoLanguageSupported = false;

function sanitizeForVariable(text) {
	// could possibly improve accuracy of sanitization, at the cost of speed,
    // by filtering on characters allowed for VARNAME as defined in SPARQL spec
    return text.replaceAll(/[^a-zA-Z0-9_]/g,"");
}

function getLanguages(languagesText) {
	const languages = languagesText.trim().split(/\s*[,\s]\s*/);
	if (languages && !isAutoLanguageSupported) {
		// check whether AUTO_LANGUAGE_NAME is erroneously one of the languages requested 
		if (languages.includes(AUTO_LANGUAGE_NAME)) {
			console.error(`Found unsupported ${AUTO_LANGUAGE_NAME} as requested language in a prefString call. Removing it.`);
			languages = languages.filter(item => item !== AUTO_LANGUAGE_NAME);
		}
	}
	// return array of languages without duplicates 
	const languagesSet = new Set(languages);
    return [...languagesSet];
}

function getLanguagesFromServiceParam(shorthandParamsText) {
	if (!shorthandParamsText) {
		return null;
	}
	const regexp = /(serviceParam>?|;)\s+[^\s]*[:\\]language>?\s+"([^"]*)"/g;
	const matchesLanguages = [...shorthandParamsText.matchAll(regexp)];
	if (matchesLanguages.length<1 || matchesLanguages[0].length<3) {
		return null;
	}
	languagesText = matchesLanguages[0][2];
	return getLanguages(languagesText);
}

function getPredicates(predicatesText) {
	// split comma-separated text (removing any spaces)
	let predicates = predicatesText.trim().split(/\s*[,\s]\s*/);
	// strip surrounding quotation marks, to support property paths as a single predicate
	// (would only work for OPTIONAL patterns, though)
	return predicates.map((predicate) => { return predicate.replace(/^"(.*)"$/, '$1'); });
}

function getPredicatesGrouped(predicatesText) {
	let predicates = getPredicates(predicatesText);
	
	// check if predicates are grouped (i.e., end in "@alt<NUMBER>") to become part of a single '|' property path
	let predicatesGrouped = {};
	const regexp = /(.*?)\\?@alt(\d+)(>?)$/g;
	for (const predicate of predicates) {
		const matchesGroupNumber = [...predicate.matchAll(regexp)];
		let predicateSuffixless = predicate;
		let groupNumber = Object.keys(predicatesGrouped).length;
		if (matchesGroupNumber && matchesGroupNumber.length > 0 && matchesGroupNumber[0].length > 2) {
			const match = matchesGroupNumber[0];
			predicateSuffixless = match[1] + match[3];
			groupNumber = match[2];
		}
		if (!(groupNumber in predicatesGrouped)) {
			predicatesGrouped[groupNumber] = [];
		}
		predicatesGrouped[groupNumber].push(predicateSuffixless);
	}
	
	return predicatesGrouped;
}

function getPredicatesFromServiceParam(shorthandParamsText) {
	if (!shorthandParamsText) {
		return null;
	}
	const regexp = /(serviceParam>?|;)\s+[^\s]*[:\\]predicate>?\s+\(([^)]*)\)/g;
	const matchesPredicates = [...shorthandParamsText.matchAll(regexp)];
	if (matchesPredicates.length<1 || matchesPredicates[0].length<3) {
		return null;
	}
	predicatesText = matchesPredicates[0][2];
	return getPredicatesGrouped(predicatesText);
}

function getSubjectsFromServiceParam(shorthandParamsText) {
	if (!shorthandParamsText) {
		return null;
	}
	const regexp = /(serviceParam>?|;)\s+[^\s]*[:\\]subject>?\s+\(([^)]*)\)/g;
	const matchesSubjects = [...shorthandParamsText.matchAll(regexp)];
	if (matchesSubjects.length<1 || matchesSubjects[0].length<3) {
		return null;
	}
	subjectsText = matchesSubjects[0][2];
	return subjectsText.trim().split(/\s*[,\s]\s*/);
}

function getSelectLabelSubjects(fullQueryText, shorthandTextIndex) {
	// get last SELECT line preceding the shorthand text
	const scopeQueryText = fullQueryText.substring(0, shorthandTextIndex);
	// to find the last occurrence of pattern, use /pattern(?![\s\S]*pattern)/
	const regexp = /SELECT[^{]*{(?![\s\S]*SELECT[^{]*{)/gmi;
	const matchesSelect = [...scopeQueryText.matchAll(regexp)];
	if (matchesSelect.length<1 || matchesSelect[0].length<1) {
		return null;
	}
	const selectText = matchesSelect[0][0];
	
	// obtain all variables from the SELECT line that end with 'Label'
	// and treat their non-Label counterparts as intended subjects
	const regexpVars = /([\?$][^\s]*)Label/g;
	const matchesVars = [...selectText.matchAll(regexpVars)];
	if (matchesVars.length<1) {
		return null;
	}
	return matchesVars.map((match) => { return match[1]; });
}

function getLabelVariablesFromServiceParam(shorthandParamsText) {
	if (!shorthandParamsText) {
		return null;
	}
	const regexp = /(serviceParam>?|;)\s*rdf:object\s*\(([^)]*)\)/g;
	const matchesObjects = [...shorthandParamsText.matchAll(regexp)];
	if (matchesObjects.length<1 || matchesObjects[0].length<3) {
		return null;
	}
	objectsText = matchesObjects[0][2];
	return objectsText.trim().split(/\s*[,\s]\s*/);
}

function createLabelVariables(subjects) {
	if (!subjects) {
		return null;
	}
	return subjects.map(subject => { return (
		subject.startsWith("?") || subject.startsWith("$") 
			? ("?" + subject.substring(1) + "Label")
			: ("?" + subject.replaceAll("<|>|.*[\\/#:]", "") + "Label")
		);
	});
}


function expandShorthandLabel(shorthandText, subjects, languages, predicatesGrouped, labelVars, indentation, mode, modeOptions) {
	let expandedShorthandLabel = "";
	subjects.forEach((subject, subjectIndex) => {
		let coalesceVars = [];
		const subjectSanitized = sanitizeForVariable(subject);
		const predicatesGroupedExclLocalname = Object.fromEntries(Object.entries(predicatesGrouped).filter(([key, item]) => !item.includes("lfn:localname")));
		if (mode == 1 || (mode != 2 && subject.startsWith("?"))) {
			// subject is a variable;
			// resort to using OPTIONAL clauses to fetch every predicate and coalesce afterwards
			for (const language of languages) {
				const languageSanitized = sanitizeForVariable(language);
				let coalesceVarsLanguage = [];
				for (const [index, predicatesGroup] of Object.entries(predicatesGroupedExclLocalname)) {
					// get the object value as potential label			
					const predicateSanitized = sanitizeForVariable(predicatesGroup[0]);
					const labelVar = `?${PREFSTRING_VAR_PREFIX}_${subjectSanitized}_${languageSanitized}_${predicateSanitized}`;
					const predicate = (predicatesGroup.length == 1) ? predicatesGroup[0] : `(${predicatesGroup.join('|')})`;
					const coalesceVarsCurrent = [...coalesceVars, ...coalesceVarsLanguage]; 
					const filterPriorBound = (!modeOptions || !modeOptions.filterPriorBound || coalesceVarsCurrent.length == 0) ? "" : (
						"\n\tFILTER (" + 
						coalesceVarsCurrent.map((coalesceVar) => { return `!bound(${coalesceVar})`; }).join(" && ") +
						") .");
					expandedShorthandLabel += `
OPTIONAL {${filterPriorBound}
	${subject} ${predicate} ${labelVar} .
	FILTER (${language == "" ? 
				`lang(${labelVar}) = ""` : 
				`langMatches(lang(${labelVar}),"${language}")` }) .
}`;
					coalesceVarsLanguage.push(labelVar);
				}
				const labelVar = `?${PREFSTRING_VAR_PREFIX}_${subjectSanitized}_${languageSanitized}`;
				const coalesceVarsLanguageText = coalesceVarsLanguage.join(", ");
				expandedShorthandLabel += `
BIND (COALESCE(${coalesceVarsLanguageText}) AS ${labelVar}) .`;
				coalesceVars.push(labelVar);
			}
		}
		else {
			// subject is either (A) a $-variable, typically bound at runtime
			//   or (B) not a variable and must be an IRI, possibly prefixed;
			// use a SELECT query instead of OPTIONAL clauses mainly to enhance readability
			const langValues = languages.map((lang, index) => { return `("${lang}" ${index})`; }).join(" ");
			const predValues = Object.values(predicatesGroupedExclLocalname).map((predicateGroup, index) => { 
				return predicateGroup.map(pred => { 
					return `(${pred} ${index})`; 
				}).join(" ") 
			}).join(" ");
			const coalesceVar = (labelVars[subjectIndex] == "?label") ? "?label" : `${labelVars[subjectIndex]}Asserted`;
			const selection = (coalesceVar == "?label") ? coalesceVar : `(?label AS ${coalesceVar})`;
			expandedShorthandLabel += `
OPTIONAL {
	SELECT ${selection}
	WHERE {
		VALUES (?lang ?langRank) { ${langValues} }
		VALUES (?pred ?predRank) { ${predValues} }

		${subject} ?pred ?label .
		FILTER (langMatches(lang(?label), ?lang)) .
	}
	ORDER BY ?langRank ?predRank
	LIMIT 1
}`;
			coalesceVars.push(coalesceVar);
		}
		// in all cases...
		if (Object.values(predicatesGrouped).filter(item => item.includes("lfn:localname")).length == 1) {
			// get the localname as potential label; possible only as ultimate fallback
			const labelVar = `?${PREFSTRING_VAR_PREFIX}_${subjectSanitized}_lfnlocalname`;
			coalesceVars.push(labelVar);
			expandedShorthandLabel += `
BIND (REPLACE(str(${subject}), "(.*[\\\\/#:](?!$))", "") AS ${labelVar}) .`;
		}
		// coalesce potential labels
		const coalesceVarsText = coalesceVars.join(", ");
		expandedShorthandLabel += `
BIND (COALESCE(${coalesceVarsText}) AS ${labelVars[subjectIndex]}) .
`;
	});
	
	expandedShorthandLabel = expandedShorthandLabel.replaceAll(/^/gm, indentation);
	const shorthandTextDisabled = shorthandText.replaceAll(/^/gm, "# ");
	const expandedText = `
########## START OF AUTOMATED EXPANSION OF SHORTHAND FOR PREFSTRING ##########
${shorthandTextDisabled}
##############################################################################
${expandedShorthandLabel}
########### END OF AUTOMATED EXPANSION OF SHORTHAND FOR PREFSTRING ###########`;
	
	return expandedText;
}


function expandShorthandLabelService(shorthandText, shorthandTextIndex, shorthandParamsText, indentation, fullQueryText, mode, modeOptions) {
	const subjects = getSubjectsFromServiceParam(shorthandParamsText) || getSelectLabelSubjects(fullQueryText, shorthandTextIndex);
	const languages = getLanguagesFromServiceParam(shorthandParamsText) || DEFAULT_PREFSTRING_LANGUAGES;
	const predicatesGrouped = getPredicatesFromServiceParam(shorthandParamsText) || DEFAULT_PREFSTRING_PREDICATES;
	const labelVars = getLabelVariablesFromServiceParam(shorthandParamsText) || createLabelVariables(subjects);
	
	if (!subjects) {
		console.error("No subjects were defined for use in the service call starting at index: " + shorthandTextIndex);
		return null;
	}
	if (!labelVars || labelVars.length != subjects.length) {
		console.error("The number of label variables defined was not equal to the number of subjects in the service call starting at index: " + shorthandTextIndex);
		return null;
	}
	
	return expandShorthandLabel(shorthandText, subjects, languages, predicatesGrouped, labelVars, indentation, mode, modeOptions);
}



function expandPrefStringServices(query, mode, modeOptions) {
	// process SERVICE :label calls
	let expandedQuery = query;
	const regexp = /^([^\n\S]*)SERVICE\s+[^\s]*[:\\]label>?\s+{([^}]*)}(\s*.)?/gim;
	const matchesLabelService = [...query.matchAll(regexp)];
	// process in reverse order; current expansion must not affect matches still to be expanded
	for (let i=matchesLabelService.length-1; i>=0;i--) {
		const match = matchesLabelService[i];
		const shorthandText = match[0];
		const shorthandTextIndex = match.index;
		const indentation = match[1];
		const shorthandParamsText = match[2];
		const expandedText = expandShorthandLabelService(shorthandText, shorthandTextIndex, shorthandParamsText, indentation, query, mode, modeOptions);

		if (expandedText) {
			expandedQuery = query.substring(0, match.index) + 
				expandedText + expandedQuery.substring(match.index + shorthandText.length);
		}
	}
	return expandedQuery;
}

function expandPrefStringFunctions(query, mode, modeOptions = { filterPriorBound: true }) {
	// process Function lfn:label or lfn:prefString calls
	let expandedQuery = query;
	const regexp = /^([^\n\S]*)BIND\s*\(\s*lfn:(label|prefString)\(([^),\s]*)\s*,\s*"([^"]*)"\s*,\s*([^)]*)\)\s+AS\s+([^\)]*)\)(\s*.)?/gim;
	const matchesLabelFunction = [...query.matchAll(regexp)];
	// process in reverse order; current expansion must not affect matches still to be expanded
	for (let i=matchesLabelFunction.length-1; i>=0;i--) {
		const match = matchesLabelFunction[i];
		const shorthandText = match[0];
		const indentation = match[1]
		const subject = match[3];
		const languages = getLanguages(match[4]);
		const predicatesGrouped = getPredicatesGrouped(match[5]);
		const labelVar = match[6];
		const expandedText = expandShorthandLabel(shorthandText, [subject], languages, predicatesGrouped, [labelVar], indentation, mode, modeOptions);

		if (expandedText) {
			expandedQuery = query.substring(0, match.index) + 
				expandedText + expandedQuery.substring(match.index + shorthandText.length);
		}
	}
	return expandedQuery;
}

function setAutoLanguageSupported(value) {
	isAutoLanguageSupported = value;
}

// expand a query and return the result;
// param 'mode' is optional and can have one of three values:
// - 0 : automated selection of expansion mode
// - 1 : a series of optional clauses (i.e., one per language/property combination)
// - 2 : a subselect query with ordering and limited to 1 result
function expandPrefString(query, mode=0, modeOptions) {
	let result = query;
	result = expandPrefStringServices(result, mode, modeOptions);
	result = expandPrefStringFunctions(result, mode, modeOptions);
	return result;
}

if (typeof module !== 'undefined') {
    module.exports = {
        setAutoLanguageSupported,
        expandPrefString,
        expandPrefStringFunctions,
        expandPrefStringServices
    };
}