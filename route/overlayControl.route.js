const express = require('express');
const overlayControlController = require('../controller/OverlayControl.controller.js');

const router = express.Router();

// POST to set the current view/theme for a round. Unauthenticated by design,
// same as every other overlay URL (the public overlay page, the public bulk
// data endpoint, the public GET below) — gated only by knowing the
// tournamentId/roundId, not by an operator login session.
router.post('/select', overlayControlController.setOverlayControl);

// GET the currently-set view/theme for a round. (The anonymous read used by
// the OBS overlay itself is a separate inline route in index.js — this one
// is what the operator dashboard would use if it ever needs to read back
// the current state.)
router.get('/:tournamentId/:roundId', overlayControlController.getOverlayControl);

module.exports = router;
