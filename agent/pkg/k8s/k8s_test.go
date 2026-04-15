package k8s

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/metrics/pkg/apis/metrics/v1beta1"
)

func TestListPodMetricsWithRetry(t *testing.T) {
	expectedList := &v1beta1.PodMetricsList{
		Items: []v1beta1.PodMetrics{
			{ObjectMeta: metav1.ObjectMeta{Name: "test-pod", Namespace: "default"}},
		},
	}

	// Override the package-level variable to mock the behavior
	originalFetch := FetchPodMetrics
	defer func() { FetchPodMetrics = originalFetch }() // Restore after test

	attempts := 0
	FetchPodMetrics = func(ctx context.Context) (*v1beta1.PodMetricsList, error) {
		attempts++
		if attempts < 2 {
			return nil, errors.New("simulated transient error")
		}
		return expectedList, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := ListPodMetricsWithRetry(ctx)

	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Len(t, result.Items, 1)
	assert.Equal(t, "test-pod", result.Items[0].Name)
	assert.Equal(t, 2, attempts, "Expected it to succeed on the second attempt after retry")
}
