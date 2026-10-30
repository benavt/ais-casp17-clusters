#!/usr/bin/env python3
"""Privacy scanner for detecting sensitive paths and hostnames in repository files.

Scans for:
- Absolute home/scratch paths: /home/<user>, /Users/<user>, /scratch/, /mnt/
- Tailscale hostnames: *.ts.net
- Common API key patterns
- Configurable hostname allowlist via PRIVACY_HOSTNAMES env var
"""

import sys
import re
import gzip
import os
import json
from pathlib import Path
from typing import List, Tuple, Set
from zipfile import ZipFile
import subprocess
import tempfile

# Patterns to detect
PATH_PATTERNS = [
    (r'/home/[a-zA-Z0-9_-]+/', 'home directory path'),
    (r'/Users/[a-zA-Z0-9_-]+/', 'macOS user path'),
    (r'/scratch/[a-zA-Z0-9_-]*', 'scratch directory path'),
    (r'/mnt/[a-zA-Z0-9_-]+/', 'mount path'),
]

# Hostname pattern - match as complete hostname or subdomain token
# Avoid false positives like "Pax" in calendar month names
HOSTNAME_PATTERN = r'(?:^|[/\s"\':,;])([a-zA-Z0-9][-a-zA-Z0-9]*\.ts\.net)(?:[/\s"\':,;]|$)'

# API key patterns (basic patterns, can be extended)
API_KEY_PATTERNS = [
    (r'(?i)api[_-]?key["\']?\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{32,})', 'API key'),
    (r'(?i)secret[_-]?key["\']?\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{32,})', 'secret key'),
]

def load_allowed_hostnames() -> Set[str]:
    """Load allowed hostnames from PRIVACY_HOSTNAMES environment variable."""
    hostnames_str = os.environ.get('PRIVACY_HOSTNAMES', '')
    if not hostnames_str:
        return set()
    return {h.strip().lower() for h in hostnames_str.split(',') if h.strip()}

def scan_text(content: str, filename: str, allowed_hostnames: Set[str]) -> List[Tuple[str, str, str]]:
    """Scan text content for sensitive patterns.
    
    Returns list of (filename, issue_type, matched_value) tuples.
    """
    issues = []
    
    # Check path patterns
    for pattern, issue_type in PATH_PATTERNS:
        matches = re.finditer(pattern, content)
        for match in matches:
            issues.append((filename, issue_type, match.group(0)))
    
    # Check hostname pattern
    matches = re.finditer(HOSTNAME_PATTERN, content)
    for match in matches:
        hostname = match.group(1).lower()
        if hostname not in allowed_hostnames:
            issues.append((filename, 'Tailscale hostname', hostname))
    
    # Check API key patterns
    for pattern, issue_type in API_KEY_PATTERNS:
        matches = re.finditer(pattern, content)
        for match in matches:
            # Redact most of the key for security
            key = match.group(1)
            redacted = key[:8] + '...' if len(key) > 8 else key
            issues.append((filename, issue_type, redacted))
    
    return issues

def read_text_from_file(filepath: Path) -> str:
    """Read text from a file, handling .gz compression."""
    try:
        if filepath.suffix == '.gz':
            with gzip.open(filepath, 'rt', encoding='utf-8', errors='ignore') as f:
                return f.read()
        else:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
    except Exception as e:
        print(f"Warning: Could not read {filepath}: {e}", file=sys.stderr)
        return ""

def extract_pptx_text(filepath: Path) -> str:
    """Extract text from PowerPoint .pptx file (Office Open XML format)."""
    try:
        text_parts = []
        with ZipFile(filepath, 'r') as pptx:
            # Extract text from slides
            for name in pptx.namelist():
                if name.startswith('ppt/slides/slide') and name.endswith('.xml'):
                    content = pptx.read(name).decode('utf-8', errors='ignore')
                    text_parts.append(content)
        return '\n'.join(text_parts)
    except Exception as e:
        print(f"Warning: Could not extract text from {filepath}: {e}", file=sys.stderr)
        return ""

def extract_pdf_text(filepath: Path) -> str:
    """Extract text from PDF using pdftotext if available."""
    try:
        result = subprocess.run(
            ['pdftotext', str(filepath), '-'],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode == 0:
            return result.stdout
        else:
            print(f"Warning: pdftotext failed for {filepath}", file=sys.stderr)
            return ""
    except FileNotFoundError:
        print(f"Warning: pdftotext not found, skipping PDF {filepath}", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"Warning: Could not extract text from {filepath}: {e}", file=sys.stderr)
        return ""

def scan_repository(root_path: Path, allowed_hostnames: Set[str]) -> List[Tuple[str, str, str]]:
    """Scan all relevant files in the repository."""
    all_issues = []
    
    # Extensions to scan
    text_extensions = {'.html', '.js', '.json', '.csv', '.txt', '.md', '.xml', '.yaml', '.yml'}
    
    for filepath in root_path.rglob('*'):
        # Skip .git directory
        if '.git' in filepath.parts:
            continue
        
        if not filepath.is_file():
            continue
        
        relative_path = str(filepath.relative_to(root_path))
        
        # Determine file type and scan accordingly
        if filepath.suffix in text_extensions:
            content = read_text_from_file(filepath)
            issues = scan_text(content, relative_path, allowed_hostnames)
            all_issues.extend(issues)
        elif filepath.suffix == '.gz':
            # Decompress and scan
            content = read_text_from_file(filepath)
            issues = scan_text(content, relative_path, allowed_hostnames)
            all_issues.extend(issues)
        elif filepath.suffix == '.pptx':
            content = extract_pptx_text(filepath)
            issues = scan_text(content, relative_path, allowed_hostnames)
            all_issues.extend(issues)
        elif filepath.suffix == '.pdf':
            content = extract_pdf_text(filepath)
            issues = scan_text(content, relative_path, allowed_hostnames)
            all_issues.extend(issues)
    
    return all_issues

def main():
    """Main entry point."""
    root_path = Path('.')
    allowed_hostnames = load_allowed_hostnames()
    
    if allowed_hostnames:
        print(f"Loaded {len(allowed_hostnames)} allowed hostname(s) from PRIVACY_HOSTNAMES")
    
    print(f"Scanning repository at {root_path.absolute()}")
    issues = scan_repository(root_path, allowed_hostnames)
    
    if issues:
        print(f"\n❌ Found {len(issues)} privacy issue(s):\n")
        for filename, issue_type, value in issues:
            print(f"  {filename}: {issue_type} - {value}")
        sys.exit(1)
    else:
        print("\n✅ No privacy issues found")
        sys.exit(0)

if __name__ == '__main__':
    main()
