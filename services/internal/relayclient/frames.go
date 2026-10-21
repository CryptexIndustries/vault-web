package relayclient

import (
	"context"
	"errors"

	"google.golang.org/protobuf/proto"

	"github.com/CryptexIndustries/vault-web/services/internal/agentpb"
	"github.com/CryptexIndustries/vault-web/services/internal/agentproto"
)

// Send hands an envelope to the relay. One over agentproto.MaxEnvelopeSize
// fails with ErrTooLarge without being sent.
func (c *Conn) Send(ctx context.Context, env *agentpb.Envelope) error {
	if proto.Size(env) > agentproto.MaxEnvelopeSize {
		return ErrTooLarge
	}
	_, err := c.call(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Send{Send: &agentpb.Send{Envelope: env}}})
	return err
}

// Ack removes a delivered envelope from this client's queue on the relay.
func (c *Conn) Ack(ctx context.Context, messageID []byte) error {
	if err := c.Err(); err != nil {
		return err
	}
	return c.write(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_Ack{Ack: &agentpb.Ack{MessageId: messageID}}})
}

// RegisterAgent registers an agent under this approver.
func (c *Conn) RegisterAgent(ctx context.Context, agentKey, revocationKey []byte) error {
	_, err := c.call(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_RegisterAgent{
		RegisterAgent: &agentpb.RegisterAgent{AgentKey: agentKey, RevocationKey: revocationKey},
	}})
	return err
}

// UnregisterAgent removes an agent; agents pass nil to remove themselves.
func (c *Conn) UnregisterAgent(ctx context.Context, agentKey []byte) error {
	_, err := c.call(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_UnregisterAgent{
		UnregisterAgent: &agentpb.UnregisterAgent{AgentKey: agentKey},
	}})
	return err
}

// RenewPass replaces the approver's relay pass.
func (c *Conn) RenewPass(ctx context.Context, pass string) error {
	_, err := c.call(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_RenewPass{RenewPass: &agentpb.RenewPass{Pass: pass}}})
	return err
}

// ClaimSlot claims a pairing slot and returns its offer.
func (c *Conn) ClaimSlot(ctx context.Context, slotID []byte) (*agentpb.SlotOffer, error) {
	reply, err := c.call(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_ClaimSlot{ClaimSlot: &agentpb.ClaimSlot{SlotId: slotID}}})
	if err != nil {
		return nil, err
	}
	offer := reply.GetSlotOffer()
	if offer == nil {
		return nil, errors.New("relay answered ClaimSlot without an offer")
	}
	return offer, nil
}

// AnswerSlot forwards the sealed PairingAccept to the agent's pairing socket.
func (c *Conn) AnswerSlot(ctx context.Context, slotID []byte, env *agentpb.Envelope) error {
	_, err := c.call(ctx, &agentpb.ClientFrame{Frame: &agentpb.ClientFrame_AnswerSlot{
		AnswerSlot: &agentpb.AnswerSlot{SlotId: slotID, Envelope: env},
	}})
	return err
}
