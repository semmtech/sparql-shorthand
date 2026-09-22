# sparql-shorthand
This JavaScript library enables the following shorthand notations in SPARQL queries:
   - `lfn:prefString` (function)
   - `laces:label` (service)
   
These shorthands conform to SPARQL syntax. When expanded by this library, they are expanded into full standardized SPARQL patterns. 
The resulting expanded query thereby offers the desired functionality even on SPARQL endpoints that do not support these functions and services. 

Prefixes required for this functionality:

```sparql
PREFIX lfn:   <https://hub.laces.tech/laces/public/functions#>
PREFIX laces: <https://hub.laces.tech/service/>
```

### lfn:prefString (SPARQL function)

The shorthand `prefString` is a function that returns a preferred string from the queried dataset, if such a string is available, based on the conditions and priorities that were passed as arguments to the function. 

Example use:

```sparql
BIND (lfn:prefString(?subject, "en,nl", dct:title, skos:prefLabel) AS ?subjectLabel) .
```

Arguments:
- *arg1*: the subject node (e.g., `?subject`)
- *arg2*: accepted languages in order of preference as a single comma-separated string (e.g., `"en,nl"` for English over Dutch; or `"en,,nl"` for an absent language flag being preferred over Dutch, and English over both)
- *arg3+*: accepted predicates in order of preference, each as a separate argument (e.g., dct:title); the last argument is allowed to be lfn:localname in order to fall back to the last segment of the subject node URI

Expands into (depending on settings): 
- OPTIONAL (for each language+predicate combination) and COALESCE (to obtain string with greatest preference)
- VALUES and ORDER BY in a sub SELECT query

Note that it is highly likely the expansion into OPTIONAL patterns is more performant, albeit lengthier in terms of text length, seeing as how that expansion will search language+predicate paris in the order of preference and will stop searching further once it is successful. The second pattern, based on VALUES and ORDER BY, would search all possible pairs before sorting through all results and selecting the preferred solution.



### laces:label (SPARQL service)

The shorthand `label` is a service that returns a preferred string from the queried dataset, much like the `prefString` shorthand function. 
This shorthand pattern is based on the Wikidata [wikibase:label](https://www.wikidata.org/wiki/Wikidata:SPARQL_tutorial#A_little_on_SERVICE_wikibase:label) service. 

```sparql
SERVICE laces:label { laces:serviceParam dct:language "en,nl" .
	                  laces:serviceParam rdf:predicate (skos:prefLabel rdfs:label) . }
```

Parameters:
- *rdf:subject* **[optional]**:  the subject nodes as a list (e.g., `(?r1 $r2 <http://example.org/r3> rdf:_4)`); if this parameter is not specified the variables will be used for which a `?<VAR>Label` counterpart is SELECTed in the query, with that Label variable counterpart used as the object to which to bind the result
- *rdf:object* **[optional]**:  the variables as a list to which to bind the results, with the positions needing to match those of the subject nodes (e.g., `(?r1Label ?r2Name ?r3Title ?mySpecialName)`); will function only if *rdf:subject parameter* is present, otherwise the preferred binding variables are already determined
- *dct:language*: accepted languages in order of preference as a single comma-separated string (e.g., `"en,nl"`)
- *rdf:predicate*: accepted predicates in order of preference as a list (e.g., `(skos:prefLabel rdfs:label)`)

Expands into (depending on settings): 
- OPTIONAL (for each language+predicate combination) and COALESCE (to obtain string with greatest preference)
- VALUES and ORDER BY in a sub SELECT query

Note that it is highly likely the expansion into OPTIONAL patterns is more performant, albeit lengthier in terms of text length, seeing as how that expansion will search language+predicate paris in the order of preference and will stop searching further once it is successful. The second pattern, based on VALUES and ORDER BY, would search all possible pairs before sorting through all results and selecting the preferred solution.

