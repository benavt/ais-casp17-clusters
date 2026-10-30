#!/usr/bin/env python3
"""Unit tests for privacy-scan.py"""

import unittest
import tempfile
import gzip
import os
from pathlib import Path
from zipfile import ZipFile
import sys

# Import the module to test
sys.path.insert(0, str(Path(__file__).parent))
import importlib.util
spec = importlib.util.spec_from_file_location("privacy_scan", Path(__file__).parent / "privacy-scan.py")
privacy_scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy_scan)

class TestPrivacyScan(unittest.TestCase):
    """Test cases for privacy scanner."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.test_path = Path(self.temp_dir)
    
    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_clean_file(self):
        """Test that clean files pass without issues."""
        clean_content = """
        This is a clean file with no sensitive information.
        It contains some data about protein structures.
        The analysis was performed on cluster data.
        """
        issues = privacy_scan.scan_text(clean_content, 'test.txt', set())
        self.assertEqual(len(issues), 0)
    
    def test_home_directory_path(self):
        """Test detection of /home/<user> paths."""
        content = "Data file: /home/alice/data/output.csv"
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'home directory path')
        self.assertIn('/home/alice/', issues[0][2])
    
    def test_macos_user_path(self):
        """Test detection of /Users/<user> paths."""
        content = "Input from /Users/bob/Documents/research/data.json"
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'macOS user path')
        self.assertIn('/Users/bob/', issues[0][2])
    
    def test_scratch_directory(self):
        """Test detection of /scratch/ paths."""
        content = "Temporary files in /scratch/job12345"
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'scratch directory path')
        self.assertIn('/scratch/', issues[0][2])
    
    def test_mnt_path(self):
        """Test detection of /mnt/ paths."""
        content = "Mounted at /mnt/storage/data"
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'mount path')
        self.assertIn('/mnt/storage/', issues[0][2])
    
    def test_tailscale_hostname(self):
        """Test detection of Tailscale hostnames."""
        content = 'Server: myserver.ts.net responded'
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'Tailscale hostname')
        self.assertEqual(issues[0][2], 'myserver.ts.net')
    
    def test_tailscale_hostname_in_url(self):
        """Test detection of Tailscale hostname in URL."""
        content = 'URL: https://compute-node.ts.net/api'
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'Tailscale hostname')
        self.assertEqual(issues[0][2], 'compute-node.ts.net')
    
    def test_plotly_pax_false_positive(self):
        """Test that Plotly calendar month 'Pax' doesn't trigger false positive."""
        # 'Pax' should not be detected as 'pax.ts.net' or similar
        content = "Calendar month: ['Jan', 'Feb', 'Mar', 'Apr', 'Pax', 'Jun']"
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        # Should find no hostname issues (Pax is not followed by .ts.net)
        hostname_issues = [i for i in issues if 'hostname' in i[1].lower()]
        self.assertEqual(len(hostname_issues), 0)
    
    def test_allowed_hostname(self):
        """Test that allowed hostnames are skipped."""
        allowed = {'myserver.ts.net'}
        content = 'Server: myserver.ts.net responded'
        issues = privacy_scan.scan_text(content, 'test.txt', allowed)
        self.assertEqual(len(issues), 0)
    
    def test_gzipped_file(self):
        """Test scanning of gzipped files."""
        gz_file = self.test_path / 'data.json.gz'
        content = b'{"path": "/home/user/data.json"}'
        with gzip.open(gz_file, 'wb') as f:
            f.write(content)
        
        text_content = privacy_scan.read_text_from_file(gz_file)
        issues = privacy_scan.scan_text(text_content, 'data.json.gz', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'home directory path')
    
    def test_multiple_issues_in_one_file(self):
        """Test detection of multiple issues in a single file."""
        content = """
        Home: /home/alice/work
        Mac: /Users/bob/data
        Scratch: /scratch/temp
        Server: compute.ts.net
        """
        issues = privacy_scan.scan_text(content, 'test.txt', set())
        self.assertEqual(len(issues), 4)
    
    def test_api_key_pattern(self):
        """Test detection of API keys."""
        content = 'api_key = "test_key_1234567890abcdefghijklmnop"'
        issues = privacy_scan.scan_text(content, 'config.json', set())
        api_issues = [i for i in issues if 'API key' in i[1]]
        self.assertGreater(len(api_issues), 0)
    
    def test_pptx_xml_content(self):
        """Test that PPTX slide XML can be scanned."""
        slide_xml = """<?xml version="1.0"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org">
            <p:txBody>
                <a:p><a:r><a:t>Analysis path: /home/researcher/results</a:t></a:r></a:p>
            </p:txBody>
        </p:sld>"""
        issues = privacy_scan.scan_text(slide_xml, 'slide.xml', set())
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0][1], 'home directory path')
    
    def test_case_insensitive_hostname(self):
        """Test that hostname matching is case-insensitive for allowlist."""
        allowed = {'myserver.ts.net'}
        content = 'Server: MyServer.TS.NET responded'
        issues = privacy_scan.scan_text(content, 'test.txt', allowed)
        self.assertEqual(len(issues), 0)
    
    def test_load_allowed_hostnames_empty(self):
        """Test loading allowed hostnames when env var is not set."""
        # Ensure env var is not set
        old_val = os.environ.pop('PRIVACY_HOSTNAMES', None)
        try:
            hostnames = privacy_scan.load_allowed_hostnames()
            self.assertEqual(len(hostnames), 0)
        finally:
            if old_val is not None:
                os.environ['PRIVACY_HOSTNAMES'] = old_val
    
    def test_load_allowed_hostnames_single(self):
        """Test loading a single allowed hostname."""
        os.environ['PRIVACY_HOSTNAMES'] = 'server1.ts.net'
        try:
            hostnames = privacy_scan.load_allowed_hostnames()
            self.assertEqual(len(hostnames), 1)
            self.assertIn('server1.ts.net', hostnames)
        finally:
            os.environ.pop('PRIVACY_HOSTNAMES', None)
    
    def test_load_allowed_hostnames_multiple(self):
        """Test loading multiple allowed hostnames."""
        os.environ['PRIVACY_HOSTNAMES'] = 'server1.ts.net, server2.ts.net, server3.ts.net'
        try:
            hostnames = privacy_scan.load_allowed_hostnames()
            self.assertEqual(len(hostnames), 3)
            self.assertIn('server1.ts.net', hostnames)
            self.assertIn('server2.ts.net', hostnames)
            self.assertIn('server3.ts.net', hostnames)
        finally:
            os.environ.pop('PRIVACY_HOSTNAMES', None)

if __name__ == '__main__':
    unittest.main()
