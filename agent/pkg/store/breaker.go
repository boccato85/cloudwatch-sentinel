package store

import (
	"errors"
	"sync"
	"time"
)

// BreakerState represents the state of the circuit breaker.
type BreakerState int

const (
	StateClosed BreakerState = iota // Normal operation, DB is healthy
	StateOpen                       // DB is down, fail fast
	StateHalfOpen                   // DB might be recovering, allow limited test traffic
)

var (
	// ErrCircuitOpen is returned when the breaker is open and fast-failing requests.
	ErrCircuitOpen = errors.New("circuit breaker is open: database is unavailable")
)

// CircuitBreaker protects the database from being overwhelmed during outages
// and prevents the agent from blocking on stalled connections.
type CircuitBreaker struct {
	mu           sync.RWMutex
	state        BreakerState
	failures     int
	maxFailures  int
	resetTimeout time.Duration
	lastFailure  time.Time
}

// NewCircuitBreaker initializes a new breaker.
func NewCircuitBreaker(maxFailures int, resetTimeout time.Duration) *CircuitBreaker {
	return &CircuitBreaker{
		state:        StateClosed,
		maxFailures:  maxFailures,
		resetTimeout: resetTimeout,
	}
}

// DBBreaker is the global instance protecting the PostgreSQL connection.
// Default: Opens after 5 consecutive failures, waits 30 seconds before testing recovery.
var DBBreaker = NewCircuitBreaker(5, 30*time.Second)

// Execute runs the given function through the circuit breaker.
func (cb *CircuitBreaker) Execute(fn func() error) error {
	if !cb.allowRequest() {
		return ErrCircuitOpen
	}

	err := fn()
	cb.recordResult(err)
	return err
}

// allowRequest determines if a request should be allowed to pass to the DB.
func (cb *CircuitBreaker) allowRequest() bool {
	cb.mu.RLock()
	state := cb.state
	last := cb.lastFailure
	timeout := cb.resetTimeout
	cb.mu.RUnlock()

	switch state {
	case StateClosed:
		return true
	case StateOpen:
		// If enough time has passed since the last failure, transition to Half-Open
		if time.Since(last) > timeout {
			cb.mu.Lock()
			// Double-check to avoid race conditions
			if cb.state == StateOpen {
				cb.state = StateHalfOpen
			}
			cb.mu.Unlock()
			return true // Allow the test request to pass
		}
		return false // Fail fast
	case StateHalfOpen:
		// Allow test requests to pass through. If they succeed, the breaker closes.
		// If they fail, it trips back to Open immediately.
		return true
	}
	return true
}

// recordResult updates the breaker's state based on the success/failure of the request.
func (cb *CircuitBreaker) recordResult(err error) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.failures++
		cb.lastFailure = time.Now()
		
		if cb.state == StateClosed && cb.failures >= cb.maxFailures {
			// Trip the breaker!
			cb.state = StateOpen
		} else if cb.state == StateHalfOpen {
			// The recovery test failed, trip it back to Open immediately
			cb.state = StateOpen
		}
	} else {
		// Success! Reset failures and close the breaker
		if cb.state != StateClosed {
			cb.state = StateClosed
		}
		cb.failures = 0
	}
}

// State returns the current string representation of the breaker's state.
// Useful for the /health endpoint and logging.
func (cb *CircuitBreaker) State() string {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	switch cb.state {
	case StateClosed:
		return "CLOSED"
	case StateOpen:
		return "OPEN"
	case StateHalfOpen:
		return "HALF-OPEN"
	default:
		return "UNKNOWN"
	}
}
