#!/usr/bin/env python3
"""relay 模块单元测试（无网络）。"""
import unittest

from relay_protein_photo import MAX_BODY_BYTES, validate_api_key


class TestValidateApiKey(unittest.TestCase):
    def test_accepts_standard_sk(self):
        self.assertTrue(validate_api_key("sk-" + "a" * 20))

    def test_accepts_token_plan_sk_sp(self):
        self.assertTrue(validate_api_key("sk-sp-" + "b" * 20))

    def test_rejects_empty(self):
        self.assertFalse(validate_api_key(""))
        self.assertFalse(validate_api_key(None))

    def test_rejects_spaces(self):
        self.assertFalse(validate_api_key("sk-abc def"))

    def test_rejects_short(self):
        self.assertFalse(validate_api_key("sk-short"))


class TestLimits(unittest.TestCase):
    def test_max_body_sane(self):
        self.assertGreater(MAX_BODY_BYTES, 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
