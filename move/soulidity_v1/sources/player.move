/// Thin downstream facade; canonical state and ledgers live in Maker.
module soulidity_v1::player;
use sui::table::{Self,Table};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_model::policy::{Self,Source,Layout};
use soulidity_foundation::economics::{Self,Config};
use sui::clock::Clock;
use soulidity_visual::visual::{Self,Scene,ColorChoice,Layer};
use soulidity_application::output::{Self};
use soulidity_maker_publication::output_data::{RecipeSlot};
use soulidity_model::assembly::{Self,State,Scope,PartKey,ProfileSnapshot};
use soulidity_maker_manufacturing::maker_player as implementation;
use soulidity_maker_manufacturing::maker_factory as factory;
use walrus::system::System;
use soulidity_maker_manufacturing::maker_player::{Player,Selection};

public(package) fun create<C>(maker:&mut Product<C>,cfg:&Config<C>,version:u64,fee_revision:u64,expiry:u64,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):ID { factory::create_native_player<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,soulidity_standard::soul::Soul>(maker,cfg,version,fee_revision,expiry,attempt,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx) }
public fun holder(p:&Player):address{ implementation::holder(p) }
public fun maker(p:&Player):ID{ implementation::maker(p) }
public fun maker_version(p:&Player):u64{ implementation::maker_version(p) }
public fun protocol(p:&Player):ID{ implementation::protocol(p) }
public fun revision(p:&Player):u64{ implementation::revision(p) }
public fun selection(p:&Player,part:vector<u8>):Option<Selection>{ implementation::selection(p,part) }
public fun scoped_selection(p:&Player,part:PartKey):Option<Selection>{ implementation::scoped_selection(p,part) }
public fun parts(p:&Player):vector<PartKey>{ implementation::parts(p) }
public fun profiles(p:&Player):vector<ProfileSnapshot>{ implementation::profiles(p) }
public fun profile_scopes(p:&Player):vector<Scope>{ implementation::profile_scopes(p) }
public fun published_profiles(p:&Player):vector<assembly::Profile>{ implementation::published_profiles(p) }
public fun source(s:&Selection):&Source{ implementation::source(s) }
public fun layout(s:&Selection):Layout{ implementation::layout(s) }
public fun assert_owner(p:&Player,expected:u64,ctx:&TxContext){ implementation::assert_owner(p,expected,ctx) }
public(package) fun set_base<C>(p:&mut Player,maker:&Product<C>,cfg:&Config<C>,definition:vector<u8>,layout:Layout,expected:u64,fee_revision:u64,expiry:u64,clock:&Clock,system:&System,ctx:&TxContext) { factory::set_native_player_base<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,soulidity_standard::soul::Soul>(p,maker,cfg,definition,layout,expected,fee_revision,expiry,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx) }
public(package) fun set_pack<C>(p:&mut Player,maker:&Product<C>,pack:&Product<C>,cfg:&Config<C>,version:u64,definition:vector<u8>,layout:Layout,expected:u64,fee_revision:u64,expiry:u64,clock:&Clock,system:&System,ctx:&TxContext) { factory::set_native_player_pack<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,soulidity_standard::soul::Soul>(p,maker,pack,cfg,version,definition,layout,expected,fee_revision,expiry,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx) }
public fun clear(p:&mut Player,part:vector<u8>,expected:u64,ctx:&TxContext){ implementation::clear(p,part,expected,ctx) }
public fun clear_scoped(p:&mut Player,part:PartKey,expected:u64,ctx:&TxContext){ implementation::clear_scoped(p,part,expected,ctx) }
public fun colors(p:&Player):vector<ColorChoice>{ implementation::colors(p) }
public fun set_colors(p:&mut Player,colors:vector<ColorChoice>,expected:u64,ctx:&TxContext){ implementation::set_colors(p,colors,expected,ctx) }
public fun pack_colors(p:&Player,scope:Scope):vector<ColorChoice>{ implementation::pack_colors(p,scope) }
public fun set_pack_colors(p:&mut Player,scope:Scope,colors:vector<ColorChoice>,expected:u64,ctx:&TxContext){ implementation::set_pack_colors(p,scope,colors,expected,ctx) }
public fun reset_layout(p:&mut Player,part:vector<u8>,expected:u64,ctx:&TxContext){ implementation::reset_layout(p,part,expected,ctx) }
public fun reset_scoped_layout(p:&mut Player,part:PartKey,expected:u64,ctx:&TxContext){ implementation::reset_scoped_layout(p,part,expected,ctx) }
public fun semantic_recipe(p:&Player):vector<RecipeSlot>{ implementation::semantic_recipe(p) }
public fun semantic_recipe_hash(p:&Player):vector<u8>{ implementation::semantic_recipe_hash(p) }
public fun render_plan(p:&Player):vector<Layer>{ implementation::render_plan(p) }
public fun close(p:Player,expected:u64,ctx:&TxContext){ implementation::close(p,expected,ctx) }

#[test_only]
public(package) fun create_for_testing<C>(maker:&mut Product<C>,cfg:&Config<C>,version:u64,fee_revision:u64,expiry:u64,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):ID { implementation::create_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,soulidity_standard::soul::Soul>(maker,cfg,version,fee_revision,expiry,attempt,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
#[test_only]
public(package) fun set_base_for_testing<C>(p:&mut Player,maker:&Product<C>,cfg:&Config<C>,definition:vector<u8>,layout:Layout,expected:u64,fee_revision:u64,expiry:u64,clock:&Clock,ctx:&TxContext) { implementation::set_base_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,soulidity_standard::soul::Soul>(p,maker,cfg,definition,layout,expected,fee_revision,expiry,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
#[test_only]
public(package) fun set_pack_for_testing<C>(p:&mut Player,maker:&Product<C>,pack:&Product<C>,cfg:&Config<C>,version:u64,definition:vector<u8>,layout:Layout,expected:u64,fee_revision:u64,expiry:u64,clock:&Clock,ctx:&TxContext) { implementation::set_pack_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,soulidity_standard::soul::Soul>(p,maker,pack,cfg,version,definition,layout,expected,fee_revision,expiry,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
