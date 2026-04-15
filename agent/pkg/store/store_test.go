package store

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
)

func TestCleanupOldMetrics(t *testing.T) {
	db, mock, err := sqlmock.New()
	assert.NoError(t, err)
	defer db.Close()
	DB = db

	ctx := context.Background()

	// Setup expectations for the sequence of DELETE operations
	mock.ExpectExec("DELETE FROM metrics").
		WithArgs(24).
		WillReturnResult(sqlmock.NewResult(0, 10))
	mock.ExpectExec("DELETE FROM metrics_hourly").
		WithArgs(30).
		WillReturnResult(sqlmock.NewResult(0, 5))
	mock.ExpectExec("DELETE FROM metrics_daily").
		WithArgs(365).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM cost_history").
		WithArgs(365).
		WillReturnResult(sqlmock.NewResult(0, 1))

	raw, hourly, daily, err := CleanupOldMetrics(ctx, 24, 30, 365)

	assert.NoError(t, err)
	assert.Equal(t, int64(10), raw)
	assert.Equal(t, int64(5), hourly)
	assert.Equal(t, int64(1), daily)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAggregateHourlyMetrics(t *testing.T) {
	db, mock, err := sqlmock.New()
	assert.NoError(t, err)
	defer db.Close()
	DB = db

	mock.ExpectExec("INSERT INTO metrics_hourly").
		WillReturnResult(sqlmock.NewResult(1, 1))

	err = AggregateHourlyMetrics(context.Background())
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}
