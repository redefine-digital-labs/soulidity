#[test_only]
module soulidity_native::storage_fixture;
use sui::coin;
use wal::wal::WAL;
use walrus::system::{Self,System};
use walrus::blob::{Self,Blob};
use walrus::messages;
use walrus::encoding;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use walrus::init;
use walrus::staking::Staking;
use walrus::test_node::{Self,TestStorageNode};
/// Real dependency Blob registration/custody, with a test-only certificate.
/// This fixture does not substitute for Walrus network or BLS service acceptance.
/// Initialize one real shared Walrus System per Scenario, through dependency
/// initialization, candidate registration, stake and epoch change. Repeated
/// local new_for_testing uses the same dummy UID for ExtendedField children.
public fun bootstrap(sc:&mut Scenario):(vector<TestStorageNode>,Clock) {
    let actor=sc.sender();let clock=clock::create_for_testing(sc.ctx());
    init::init_for_testing(sc.ctx());
    let upgrade=sui::package::test_publish(sc.ctx().fresh_object_address().to_id(),sc.ctx());
    sc.next_tx(actor);let cap:init::InitCap=sc.take_from_sender();
    let emergency=init::initialize_for_testing(cap,upgrade,100000000,1209600000,1000,53,&clock,sc.ctx());
    transfer::public_transfer(emergency,actor);sc.next_tx(actor);
    let mut nodes=test_node::test_nodes();
    nodes.do_mut!(|node|{
        sc.next_tx(node.sui_address());let mut staking:Staking=sc.take_shared();
        let cap=staking.register_candidate(node.name(),node.network_address(),node.metadata(),node.bls_pk(),node.network_key(),node.create_proof_of_possession(0),0,10000,20000,1000000000000,sc.ctx());
        node.set_storage_node_cap(cap);test_scenario::return_shared(staking);
    });
    nodes.do_ref!(|node|{
        sc.next_tx(node.sui_address());let mut staking:Staking=sc.take_shared();
        let coin=walrus::test_utils::mint_wal(1000,sc.ctx());let stake=staking.stake_with_pool(coin,node.node_id(),sc.ctx());
        transfer::public_transfer(stake,sc.sender());test_scenario::return_shared(staking);
    });
    let mut clock=clock;clock::increment_for_testing(&mut clock,100000000);
    sc.next_tx(actor);let mut staking:Staking=sc.take_shared();let mut system:System=sc.take_shared();
    staking.voting_end(&clock);staking.initiate_epoch_change(&mut system,&clock);
    assert!(system::epoch(&system)==1 && system::total_capacity_size(&system)>0,0);
    test_scenario::return_shared(staking);test_scenario::return_shared(system);
    nodes.do_mut!(|node|{
        sc.next_tx(node.sui_address());let mut staking:Staking=sc.take_shared();staking.epoch_sync_done(node.cap_mut(),1,&clock);test_scenario::return_shared(staking);
    });sc.next_tx(actor);(nodes,clock)
}
public fun initialize(sc:&mut Scenario) {
    let(nodes,clock)=bootstrap(sc);nodes.do!(|node|node.destroy());clock::destroy_for_testing(clock)
}
/// Run the dependency epoch transition rather than editing a stored epoch field.
public fun next_epoch(sc:&mut Scenario,system:&mut System,nodes:&mut vector<TestStorageNode>,clock:&mut Clock) {
    let actor=sc.sender();clock::increment_for_testing(clock,1209600000);
    sc.next_tx(actor);let mut staking:Staking=sc.take_shared();staking.voting_end(clock);staking.initiate_epoch_change(system,clock);test_scenario::return_shared(staking);
    let epoch=system::epoch(system);nodes.do_mut!(|node|{
        sc.next_tx(node.sui_address());let mut staking:Staking=sc.take_shared();staking.epoch_sync_done(node.cap_mut(),epoch,clock);test_scenario::return_shared(staking)
    });sc.next_tx(actor);
}
public fun blob(system:&mut System,root_hash:u256,deletable:bool,certified:bool,ctx:&mut TxContext):Blob {
    let mut payment=coin::mint_for_testing<WAL>(1000000000,ctx);
    let amount=encoding::encoded_blob_length(1024,1,system::n_shards(system));
    let reservation=system::reserve_space(system,amount,3,&mut payment,ctx);
    let blob_id=blob::derive_blob_id(root_hash,1,1024);
    let mut blob=system::register_blob(system,reservation,blob_id,root_hash,1024,1,deletable,&mut payment,ctx);
    coin::burn_for_testing(payment);
    if(certified) {
        let message=if(deletable)messages::certified_deletable_blob_message_for_testing(blob_id,object::id(&blob)) else messages::certified_permanent_blob_message_for_testing(blob_id);
        blob::certify_with_certified_msg_for_testing(&mut blob,system::epoch(system),message)
    };
    blob
}
public fun return_system(system:System){test_scenario::return_shared(system)}
