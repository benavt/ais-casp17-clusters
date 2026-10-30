#!/usr/bin/env python3
"""Size guard script to check for large tracked files.

Fails if any tracked file exceeds the maximum size limit.
"""

import sys
import subprocess
from pathlib import Path

MAX_SIZE_MB = 50
MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024

def check_file_sizes() -> list:
    """Check all tracked files for size violations.
    
    Returns list of (filepath, size_mb) tuples for files exceeding limit.
    """
    violations = []
    
    # Get all tracked files
    result = subprocess.run(
        ['git', 'ls-files', '-z'],
        capture_output=True,
        text=True,
        check=True
    )
    
    # Split on null bytes (handles filenames with spaces)
    files = [f for f in result.stdout.split('\0') if f]
    
    for filepath in files:
        path = Path(filepath)
        if not path.exists():
            continue
        
        size_bytes = path.stat().st_size
        if size_bytes > MAX_SIZE_BYTES:
            size_mb = size_bytes / (1024 * 1024)
            violations.append((filepath, size_mb))
    
    return violations

def main():
    """Main entry point."""
    print(f"Checking tracked files for size violations (max: {MAX_SIZE_MB} MB)")
    
    violations = check_file_sizes()
    
    if violations:
        print(f"\n❌ Found {len(violations)} file(s) exceeding size limit:\n")
        for filepath, size_mb in violations:
            print(f"  {filepath}: {size_mb:.2f} MB")
        sys.exit(1)
    else:
        print("\n✅ All tracked files are within size limits")
        sys.exit(0)

if __name__ == '__main__':
    main()
