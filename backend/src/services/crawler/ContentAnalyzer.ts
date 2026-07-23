import * as cheerio from 'cheerio';
import type { IExtractedData } from '../../models/CrawlResult.model';
import { resolveUrl, isValidUrl } from '../../utils/urlUtils';

// Derive the loaded-document API type from cheerio.load to stay compatible
// across cheerio versions (the named export moved between releases).
type CheerioAPI = ReturnType<typeof cheerio.load>;

export interface ContentAnalysis {
  title: string;
  contentLength: number;
  relevanceScore: number; // 0–100
  matchedKeywords: string[];
  matchedPhrases: string[];
  extracted: IExtractedData;
  rawTextSnippet: string;
}

const MAX_PARAGRAPHS = 50;
const MAX_HEADINGS = 40;
const MAX_LINKS = 100;
const MAX_IMAGES = 30;
const SNIPPET_LENGTH = 500;

/**
 * Parses fetched HTML into structured data and scores how well the page matches
 * the user's keywords/phrases. Pure and stateless — no I/O — so it is trivial to
 * unit test and reuse across crawler strategies.
 */
export class ContentAnalyzer {
  analyze(
    html: string,
    url: string,
    keywords: string[],
    phrases: string[]
  ): ContentAnalysis {
    const $ = cheerio.load(html);

    // Strip non-content nodes before extracting text.
    $('script, style, noscript, template, svg').remove();

    const title = this.getTitle($);
    const extracted = this.extractData($, url);
    const bodyText = this.getBodyText($);
    const haystack = `${title}\n${bodyText}`.toLowerCase();

    const { matchedKeywords, matchedPhrases, relevanceScore } = this.score(
      haystack,
      keywords,
      phrases
    );

    return {
      title,
      contentLength: bodyText.length,
      relevanceScore,
      matchedKeywords,
      matchedPhrases,
      extracted,
      rawTextSnippet: bodyText.slice(0, SNIPPET_LENGTH).trim(),
    };
  }

  private getTitle($: CheerioAPI): string {
    return (
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Untitled'
    );
  }

  private getBodyText($: CheerioAPI): string {
    return $('body').text().replace(/\s+/g, ' ').trim();
  }

  private extractData($: CheerioAPI, url: string): IExtractedData {
    const headings: string[] = [];
    $('h1, h2, h3').each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text && headings.length < MAX_HEADINGS) headings.push(text);
    });

    const paragraphs: string[] = [];
    $('p').each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length > 20 && paragraphs.length < MAX_PARAGRAPHS) {
        paragraphs.push(text);
      }
    });

    const links: string[] = [];
    const seenLinks = new Set<string>();
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const resolved = resolveUrl(url, href);
      if (resolved && isValidUrl(resolved) && !seenLinks.has(resolved) && links.length < MAX_LINKS) {
        seenLinks.add(resolved);
        links.push(resolved);
      }
    });

    const images: string[] = [];
    const seenImages = new Set<string>();
    $('img[src]').each((_i, el) => {
      const src = $(el).attr('src');
      if (!src) return;
      const resolved = resolveUrl(url, src);
      if (resolved && !seenImages.has(resolved) && images.length < MAX_IMAGES) {
        seenImages.add(resolved);
        images.push(resolved);
      }
    });

    return {
      headings,
      paragraphs,
      links,
      images,
      metaTitle: $('title').first().text().trim() || undefined,
      metaDescription: $('meta[name="description"]').attr('content')?.trim() || undefined,
      structuredData: this.extractStructuredData($),
    };
  }

  private extractStructuredData($: CheerioAPI): Record<string, unknown>[] {
    const data: Record<string, unknown>[] = [];

    $('script[type="application/ld+json"]').each((_i, el) => {
      const raw = $(el).contents().text();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          data.push(...parsed.filter((x) => x && typeof x === 'object'));
        } else if (parsed && typeof parsed === 'object') {
          data.push(parsed);
        }
      } catch {
        // Ignore malformed JSON-LD blocks.
      }
    });

    return data;
  }

  /**
   * Relevance heuristic: keywords are worth up to 60 points (by frequency,
   * with diminishing returns), phrases up to 40. Pages with no configured
   * keywords/phrases score 0 (the orchestrator still stores them).
   */
  private score(
    haystack: string,
    keywords: string[],
    phrases: string[]
  ): { matchedKeywords: string[]; matchedPhrases: string[]; relevanceScore: number } {
    const matchedKeywords: string[] = [];
    const matchedPhrases: string[] = [];

    if (keywords.length === 0 && phrases.length === 0) {
      return { matchedKeywords, matchedPhrases, relevanceScore: 0 };
    }

    let keywordScore = 0;
    for (const keyword of keywords) {
      const term = keyword.toLowerCase().trim();
      if (!term) continue;
      const count = this.countOccurrences(haystack, term);
      if (count > 0) {
        matchedKeywords.push(keyword);
        // Diminishing returns: log scale so one spammy word can't dominate.
        keywordScore += Math.min(1, Math.log2(count + 1) / 4);
      }
    }

    let phraseScore = 0;
    for (const phrase of phrases) {
      const term = phrase.toLowerCase().trim();
      if (!term) continue;
      if (haystack.includes(term)) {
        matchedPhrases.push(phrase);
        phraseScore += 1;
      }
    }

    const keywordPart = keywords.length
      ? (keywordScore / keywords.length) * 60
      : 0;
    const phrasePart = phrases.length ? (phraseScore / phrases.length) * 40 : 0;

    const relevanceScore = Math.round(
      Math.min(100, keywordPart + phrasePart)
    );

    return { matchedKeywords, matchedPhrases, relevanceScore };
  }

  private countOccurrences(haystack: string, term: string): number {
    if (!term) return 0;
    let count = 0;
    let index = haystack.indexOf(term);
    while (index !== -1) {
      count++;
      index = haystack.indexOf(term, index + term.length);
    }
    return count;
  }
}
