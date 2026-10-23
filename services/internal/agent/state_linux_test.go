package agent

import (
	"testing"

	"golang.org/x/sys/unix"
)

// `unpair` deleting state.json while the service saves a change must not
// see the service write the old pairing back. inotify starts the delete
// when the service creates its temporary file, after it read state.json and
// before it renames over it.
func TestServiceWriteDoesNotResurrectUnpairedState(t *testing.T) {
	s := newTestService(t)
	for attempt := range 200 {
		loadState(t, s, testState(1))
		fd, err := unix.InotifyInit1(unix.IN_CLOEXEC)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := unix.InotifyAddWatch(fd, s.store.Dir, unix.IN_CREATE); err != nil {
			unix.Close(fd)
			t.Fatal(err)
		}
		deleted := make(chan error, 1)
		go func() {
			buf := make([]byte, 4096)
			_, err := unix.Read(fd, buf)
			if err == nil {
				_, err = s.store.DeleteStateOf(testState(1).SignSeed)
			}
			deleted <- err
		}()
		s.mu.Lock()
		err = s.updateLocked(func(st *State) { st.Confirmed = true })
		s.mu.Unlock()
		deleteErr := <-deleted
		unix.Close(fd)
		if err != nil {
			t.Fatal(err)
		}
		if deleteErr != nil {
			t.Fatal(deleteErr)
		}
		st, err := s.store.LoadState()
		if err != nil {
			t.Fatal(err)
		}
		if st != nil {
			t.Fatalf("attempt %d: state.json came back after unpair deleted it", attempt)
		}
	}
}
