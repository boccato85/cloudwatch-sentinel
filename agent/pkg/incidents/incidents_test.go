package incidents

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAnalyzeWaste(t *testing.T) {
	thresholds := defaultThresholds()
	
	// Case 1: No waste
	saving, opportunity, wastePct, severity := AnalyzeWaste(true, 1000, 900, thresholds)
	assert.Nil(t, saving)
	assert.Equal(t, "", opportunity)
	assert.Equal(t, 0.0, wastePct)
	assert.Equal(t, "", severity)

	// Case 2: Warning level waste (e.g., 65% wasted > 60% threshold)
	// cpuRequest=1000, usage=350, wasted=650 (65%)
	saving, opportunity, wastePct, severity = AnalyzeWaste(true, 1000, 350, thresholds)
	assert.NotNil(t, saving)
	assert.Equal(t, int64(650), *saving)
	assert.Equal(t, "-650m", opportunity)
	assert.Equal(t, 65.0, wastePct)
	assert.Equal(t, "warning", severity)

	// Case 3: Critical level waste (e.g., 85% wasted > 80% critical threshold)
	// cpuRequest=1000, usage=150, wasted=850 (85%)
	saving, opportunity, wastePct, severity = AnalyzeWaste(true, 1000, 150, thresholds)
	assert.NotNil(t, saving)
	assert.Equal(t, int64(850), *saving)
	assert.Equal(t, "-850m", opportunity)
	assert.Equal(t, 85.0, wastePct)
	assert.Equal(t, "critical", severity)
}
