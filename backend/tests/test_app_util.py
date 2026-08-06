"""Unit tests for app-layer helpers in `app.util`.

`normalize_playlist_name` is the canonical playlist-name rule
(planning/01-data-model.md §7.1). It used to be defined twice — here in
`app.util` and again in `pipeline.stage3_compare` — with the tests pointed at
the pipeline copy that no production code path called, so an edit to the
shipped copy could change playlist matching while the suite stayed green
(#199). There is now one definition, and these tests import it from the same
module every caller uses.
"""

from app.util import normalize_playlist_name


class TestNormalizePlaylistName:
    def test_canonical_equivalences(self):
        assert (normalize_playlist_name("disco_cosmic")
                == normalize_playlist_name("Disco Cosmic")
                == normalize_playlist_name("DISCOCOSMIC")
                == "discocosmic")

    def test_punctuation_significant(self):
        assert normalize_playlist_name("VNRBLM-7-18-2026") == "vnrblm-7-18-2026"
        assert normalize_playlist_name("a-b") != normalize_playlist_name("ab")
